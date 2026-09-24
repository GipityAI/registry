"""
@gipity/audio-align — forced alignment GPU job

Pipeline:
  1. Download audio from input.audio_url
  2. Demucs vocal isolation (4-stem model, take the vocals stem)
  3. Per-word phonetic normalisation:
       - Bare acronyms (AI, AWS) → spelled out as letters ("ay eye", "ay double you ess")
       - Letter-dash sequences (A-W-S, M-V-P) → spelled out
       - Word-as-letter literals (EYE alone = letter I)
       - Hyphenated multi-syllable spellings (Jip-ih-tee → "jip ih tee", 3 aligner words)
       - Smart-quote / em-dash unicode folding
     Each display word is index-locked to N aligner words so MMS_FA gets clean
     ASCII tokens to tokenize while output JSON keeps the user's original spelling.
  4. torchaudio MMS_FA forced alignment on the vocal stem
  5. Librosa onset refinement (snap word starts to nearest audio onset within ±50ms)
  6. Return word-timing JSON

Input shape (read via `ctx.input`):
  {
    "audio_url": "https://...",          # required, audio file URL (mp3/wav/m4a/...). Max 100 MB.
    "lyrics": "line one\\nline two ...",  # required, DISPLAY text. May include acronyms (AI, AWS),
                                          # letter-dash sequences (N-P-M), and hyphenated phonetic
                                          # respellings (Jip-ih-tee) — the kit handles them inline.
    "phonetic_lyrics": "...",            # optional, full manual respelling. Same word/line shape
                                          # as `lyrics`. If set, overrides the per-word phonetic
                                          # auto-normalisation. Word count MUST match `lyrics`.
    "corrections": [                      # optional, lighter alternative to phonetic_lyrics: a flat
      {"from": "Gipity", "to": "Jip-ih-tee"},   # list of display→phonetic word replacements applied
      {"from": "AWS",    "to": "A-W-S"}         # before alignment. Used only when phonetic_lyrics
    ],                                          # is absent.
    "skip_demucs": false,                # optional, true = align on raw audio (faster, less accurate)
    "refine_onsets": true                # optional, librosa onset snap
  }

Output shape (set via `ctx.set_output`, stored as the run's `output` field):
  {
    "words": [
      {
        "word": "AI",            # legacy alias — same as `display`
        "source": "AI",          # raw token from `lyrics`
        "display": "AI",         # what the renderer should show
        "phonetic": "ay eye",    # what MMS_FA actually aligned against (multi-word allowed)
        "trailing_punct": ",",   # punctuation glued to this word in the source (",", "!", "?", ...)
        "start_ms": 1234,
        "end_ms":   1456,
        "confidence": 0.95,
        "aligned":  true
      },
      ...
    ],
    "phrases": [{ "text": "...", "start_ms": ..., "end_ms": ..., "word_idx_start": ..., "word_idx_end": ... }, ...],
    "warnings": [],                       # non-empty when the alignment looks unreliable overall,
                                          # e.g. most words low-confidence (lyrics/audio mismatch)
    "metadata": { "duration_ms": ..., "sample_rate": 16000, "used_demucs": true, "refined_onsets": true,
                  "unaligned_count": 0, "low_confidence_count": 0, "low_confidence_ratio": 0.0 }
  }

Every input display word emits exactly one entry in `words[]` (the 1:1 mapping
makes phrase reconstruction trivial), even when the phonetic form spans
multiple aligner tokens. Tokens MMS_FA failed to align get
`aligned: false, confidence: 0` and timing synthesised from neighbours.

Caching: demucs + MMS_FA weights cache to /cache/torch and /cache/hf on first
run (~600 MB total) and persist across runs.

Fat-image deps: torch, torchaudio, demucs, librosa, numpy - all baked into the
Modal image. No requirements.txt needed.
"""
import json
import os
import re
import sys
import tempfile
import unicodedata
import urllib.request

from gipity_ctx import ctx  # platform SDK, injected alongside the handler


# ─── Phonetic normalisation (ported from siverson914/SupCap/src/supcap/phonetics.py) ───
#
# Anything outside MMS_FA's English char alphabet (lowercase a-z + apostrophe)
# breaks the tokenizer. These helpers convert each raw token into one or more
# aligner-safe words while keeping the original display string intact.

_LETTER_TO_WORD = {
    "a": "ay", "b": "bee", "c": "see", "d": "dee", "e": "ee", "f": "eff",
    "g": "gee", "h": "aitch", "i": "eye", "j": "jay", "k": "kay", "l": "ell",
    "m": "em", "n": "en", "o": "oh", "p": "pee", "q": "cue", "r": "ar",
    "s": "ess", "t": "tee", "u": "you", "v": "vee", "w": "double you",
    "x": "eks", "y": "why", "z": "zee",
}

# Tokens written as a word but meaning a letter when sung (e.g. "EYE" = letter I).
# Only fires when the WHOLE token is uppercase, so lowercase "are you there?"
# keeps the literal word.
_WORD_AS_LETTER = {
    "eye": "eye",   # I
    "see": "see",   # C
    "bee": "bee",   # B
    "are": "ar",    # R
    "you": "you",   # U
    "why": "why",   # Y
}

_VALID_ALIGN_CHAR_RE = re.compile(r"[^a-z' ]+")  # MMS_FA dict: a-z + apostrophe + space


def _strip_outer_punct(s: str) -> str:
    """Strip leading non-word + trailing non-word-but-keep-apostrophe.
    Preserves internal hyphens / apostrophes for the per-rule logic below.
    """
    s = re.sub(r"^[^\w]+", "", s)
    s = re.sub(r"[^\w']+$", "", s)
    return s


def _is_letter_dash_sequence(token: str) -> bool:
    """True for 'A-W-S', 'M-V-P', 'A-I', 'N-P-M' — 2+ single letters joined by hyphens."""
    parts = token.split("-")
    if len(parts) < 2:
        return False
    return all(len(p) == 1 and p.isalpha() for p in parts)


def _expand_letters(token: str) -> str:
    """'A-W-S' → 'ay double you ess'."""
    parts = token.lower().split("-")
    return " ".join(_LETTER_TO_WORD[p] for p in parts if p in _LETTER_TO_WORD)


def _is_bare_acronym(token: str) -> bool:
    """True for short bare ALL-CAPS like 'AI', 'NPM', 'AWS' (2-4 letters, no dashes)."""
    return 2 <= len(token) <= 4 and token.isalpha() and token.isupper()


def _flatten_letters(token: str) -> str:
    """'AI' → 'ay eye'."""
    return " ".join(_LETTER_TO_WORD[c.lower()] for c in token)


def _clean_for_aligner(text: str) -> str:
    """Final cleanup before MMS_FA — lowercase, strip anything outside the char dict."""
    text = text.lower()
    text = _VALID_ALIGN_CHAR_RE.sub(" ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def phonetic_normalize(raw_word: str) -> tuple[str, str]:
    """Convert one raw lyric token → (alignment_form, phonetic_form).

    alignment_form: lowercase, no spaces, suitable as a JSON `text` field
    phonetic_form:  space-separated; may have multiple words MMS_FA aligns against
    """
    # Unicode normalisation: smart quotes / em-dashes → ASCII equivalents.
    raw = unicodedata.normalize("NFKC", raw_word)
    raw = raw.replace("’", "'").replace("‘", "'")  # curly → straight
    raw = raw.replace("—", "-").replace("–", "-")  # em/en dash → hyphen
    raw = _strip_outer_punct(raw)
    if not raw:
        return "", ""

    # 1. Letter-dash sequences: A-W-S, M-V-P, N-P-M, A-I.
    if _is_letter_dash_sequence(raw):
        phonetic = _expand_letters(raw)
        return phonetic.replace(" ", ""), phonetic

    # 2. Word-as-letter literals: bare uppercase EYE, ARE, etc.
    folded = raw.lower()
    if raw.isupper() and folded in _WORD_AS_LETTER:
        phonetic = _WORD_AS_LETTER[folded]
        return phonetic.replace(" ", ""), phonetic

    # 3. Bare short all-caps: AI, NPM, AWS, MVP.
    if _is_bare_acronym(raw):
        phonetic = _flatten_letters(raw)
        return phonetic.replace(" ", ""), phonetic

    # 4. Hyphenated stylized phonetic spellings: Jip-ih-tee, Brand-new, agent-tuned.
    #    For an alignment form we collapse to lowercase (used as the JSON `text`);
    #    for phonetic we keep the hyphens as syllable separators so the aligner
    #    gets multiple words to anchor on.
    if "-" in raw:
        parts = [p for p in raw.lower().split("-") if p]
        if parts:
            phonetic = " ".join(parts)
            # Final scrub in case a part had non-dict chars (numbers etc.)
            phonetic = _clean_for_aligner(phonetic)
            return phonetic.replace(" ", ""), phonetic

    # 5. Plain word — case-fold for alignment, same string for phonetic.
    cleaned = _clean_for_aligner(raw)
    return cleaned, cleaned


# ─── Trailing punctuation extraction ────────────────────────────────────────
# Pull the single most-significant trailing punctuation char off each whitespace-
# separated token. We keep the punctuation off the source field so the aligner
# never sees it, but emit it as `trailing_punct` so the renderer can put it back.
_DISPLAY_PUNCT = {",", ".", ";", ":", "!", "?"}


def _split_trailing_punct(token: str) -> tuple[str, str]:
    """'here,' → ('here', ',') ; 'world!' → ('world', '!')"""
    if not token:
        return token, ""
    last = token[-1]
    if last in _DISPLAY_PUNCT:
        return token[:-1], last
    return token, ""


# ─── Main ───────────────────────────────────────────────────────────────────

def main() -> None:
    payload = ctx.input

    audio_url = payload.get("audio_url")
    lyrics = payload.get("lyrics")
    if not audio_url or not lyrics:
        print(json.dumps({"error": "audio_url and lyrics are required"}), file=sys.stderr)
        sys.exit(2)

    skip_demucs = bool(payload.get("skip_demucs", False))
    refine_onsets = bool(payload.get("refine_onsets", True))
    phonetic_lyrics = payload.get("phonetic_lyrics")
    corrections = payload.get("corrections")

    # ── Choose how to produce per-word phonetic forms ──────────────────────
    # Priority: phonetic_lyrics (caller-supplied full respelling)
    #         > corrections (caller-supplied display→phonetic dict)
    #         > inline phonetic_normalize() (kit's own rules)
    #
    # All paths produce a list parallel to `display_words` with the phonetic
    # form for each. phonetic_form is what MMS_FA tokenises; display word is
    # what we emit in the output JSON.
    lyric_lines_raw = [line for line in lyrics.splitlines() if line.strip()]
    if not lyric_lines_raw:
        print(json.dumps({"error": "lyrics has no non-empty lines"}), file=sys.stderr)
        sys.exit(2)

    # Per-line word-level extraction with trailing-punct stripping. After this:
    #   display_lines = [["AI", "works", "better", "here", ...], ...]
    #   punct_lines   = [["", "", "", ",", ...], ...]
    display_lines: list[list[str]] = []
    punct_lines: list[list[str]] = []
    for line in lyric_lines_raw:
        words_with_punct = [_split_trailing_punct(t) for t in line.split()]
        display_lines.append([w for w, _ in words_with_punct])
        punct_lines.append([p for _, p in words_with_punct])
    display_words = [w for ws in display_lines for w in ws]
    trailing_puncts = [p for ps in punct_lines for p in ps]

    # Determine the phonetic source per word.
    if phonetic_lyrics is not None:
        if not isinstance(phonetic_lyrics, str):
            print(json.dumps({"error": "phonetic_lyrics must be a string"}), file=sys.stderr)
            sys.exit(2)
        phon_lines_raw = [line for line in phonetic_lyrics.splitlines() if line.strip()]
        if len(phon_lines_raw) != len(lyric_lines_raw):
            print(json.dumps({"error": "phonetic_lyrics must have the same number of non-empty lines as lyrics"}), file=sys.stderr)
            sys.exit(2)
        phon_words = []
        for ll, pl in zip(display_lines, phon_lines_raw):
            ptoks = [_split_trailing_punct(t)[0] for t in pl.split()]
            if len(ptoks) != len(ll):
                print(json.dumps({"error": f"per-line word count mismatch: lyrics has {len(ll)} words, phonetic has {len(ptoks)}"}), file=sys.stderr)
                sys.exit(2)
            phon_words.extend(ptoks)
        # Apply the per-word phonetic_normalize so caller-supplied respellings
        # like "Jip-ih-tee" still get split into multi-aligner-words.
        per_word_phonetics = [phonetic_normalize(w)[1] for w in phon_words]
    elif corrections is not None:
        if not isinstance(corrections, list):
            print(json.dumps({"error": "corrections must be an array of {from, to} objects"}), file=sys.stderr)
            sys.exit(2)
        replace_map: dict[str, str] = {}
        for c in corrections:
            if not isinstance(c, dict) or not isinstance(c.get("from"), str) or not isinstance(c.get("to"), str):
                print(json.dumps({"error": "each correction must be {from: string, to: string}"}), file=sys.stderr)
                sys.exit(2)
            replace_map[c["from"]] = c["to"]
        per_word_phonetics = [phonetic_normalize(replace_map.get(w, w))[1] for w in display_words]
    else:
        # Pure inline path — the kit's own phonetics layer handles acronyms,
        # letter-dash, hyphenated multi-syllable, etc.
        per_word_phonetics = [phonetic_normalize(w)[1] for w in display_words]

    # Build the flat aligner-word list + word_to_subcount tracking. A single
    # display word like "Jip-ih-tee" (phonetic="jip ih tee") becomes THREE
    # aligner words; we record `3` in word_to_subcount[idx]. Display words
    # with no audio-alignable content (em-dashes, pure punctuation, chars
    # outside the MMS dict) get word_to_subcount[idx] = 0 and are flagged as
    # placeholders — they're never sent to the tokenizer (MMS rejects any
    # out-of-dict char including underscores), and downstream re-grouping
    # synthesises their timing from neighbours.
    align_words: list[str] = []
    word_to_subcount: list[int] = []
    placeholder_indices: set[int] = set()
    for idx, phon in enumerate(per_word_phonetics):
        cleaned = _clean_for_aligner(phon) if phon else ""
        parts = cleaned.split() if cleaned else []
        if not parts:
            placeholder_indices.add(idx)
            word_to_subcount.append(0)
        else:
            align_words.extend(parts)
            word_to_subcount.append(len(parts))

    if not align_words:
        print(json.dumps({"error": "no aligner-safe content from any word"}), file=sys.stderr)
        sys.exit(2)

    # ── Late imports (heavy; only after input validation) ──────────────────
    import torch
    import torchaudio
    from torchaudio.pipelines import MMS_FA as mms_bundle
    import librosa
    import numpy as np

    # librosa.load handles WAV/FLAC/OGG natively and falls back to audioread+
    # ffmpeg for MP3/M4A — same path the original SupCap io_utils.load_audio
    # uses. Sidesteps torchaudio 2.4+ routing through `torchcodec` (which
    # isn't in the platform's fat Modal image).
    def _load_audio_np(path: str, target_sr: int | None = None) -> tuple["np.ndarray", int]:
        y, sr = librosa.load(path, sr=target_sr, mono=True)
        return y.astype(np.float32, copy=False), sr

    if not torch.cuda.is_available():
        print(json.dumps({"error": "no CUDA - this job must run on a GPU compute class"}), file=sys.stderr)
        sys.exit(3)
    device = torch.device("cuda")

    tmpdir = tempfile.mkdtemp(prefix="align-")
    audio_path = os.path.join(tmpdir, "input")
    MAX_AUDIO_BYTES = 100 * 1024 * 1024  # 100 MB cap

    # ── 1. Download audio ──────────────────────────────────────────────────
    ctx.progress(0.05, "downloading audio")
    try:
        with urllib.request.urlopen(audio_url, timeout=30) as resp:
            content_length = resp.headers.get("Content-Length")
            if content_length and int(content_length) > MAX_AUDIO_BYTES:
                print(json.dumps({"error": f"audio file too large: {int(content_length)} bytes (max {MAX_AUDIO_BYTES})"}), file=sys.stderr)
                sys.exit(2)
            bytes_read = 0
            with open(audio_path, "wb") as out:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    bytes_read += len(chunk)
                    if bytes_read > MAX_AUDIO_BYTES:
                        print(json.dumps({"error": f"audio file exceeded {MAX_AUDIO_BYTES} bytes mid-download"}), file=sys.stderr)
                        sys.exit(2)
                    out.write(chunk)
    except urllib.error.HTTPError as e:
        print(json.dumps({"error": f"HTTP {e.code} fetching audio_url: {e.reason}"}), file=sys.stderr)
        sys.exit(2)
    except urllib.error.URLError as e:
        print(json.dumps({"error": f"network error fetching audio_url: {e.reason}"}), file=sys.stderr)
        sys.exit(2)

    # ── 2. Demucs vocal isolation (optional) ───────────────────────────────
    vocals_path = audio_path
    if not skip_demucs:
        ctx.progress(0.15, "running demucs vocal isolation")
        from demucs.pretrained import get_model as demucs_get_model
        from demucs.apply import apply_model
        import soundfile as sf  # only needed to write demucs output

        # Demucs expects stereo at the source sample rate. librosa.load(mono=True)
        # is fine for the aligner but we want stereo for demucs.
        y_mono, sr = librosa.load(audio_path, sr=None, mono=True)
        wav = np.stack([y_mono, y_mono], axis=0).astype(np.float32, copy=False)
        waveform = torch.from_numpy(wav).to(device)
        model = demucs_get_model("htdemucs").to(device)
        model.eval()
        with torch.no_grad():
            sources = apply_model(model, waveform[None], device=device.type)[0]
        # htdemucs source order: ['drums', 'bass', 'other', 'vocals']
        vocals = sources[3].cpu().numpy()
        vocals_path = os.path.join(tmpdir, "vocals.wav")
        sf.write(vocals_path, vocals.T, sr)  # soundfile wants (samples, channels)
        del model, sources

    # ── 3. MMS_FA forced alignment ─────────────────────────────────────────
    ctx.progress(0.55, "running MMS_FA forced alignment")
    model = mms_bundle.get_model().to(device)
    tokenizer = mms_bundle.get_tokenizer()
    aligner = mms_bundle.get_aligner()

    # MMS_FA expects 16 kHz mono. librosa handles resampling for us.
    y, sr = _load_audio_np(vocals_path, target_sr=mms_bundle.sample_rate)
    waveform = torch.from_numpy(y).unsqueeze(0).to(device)  # (1, samples)

    with torch.inference_mode():
        emission, _ = model(waveform)
    emission_cpu = emission.cpu()

    # If MMS chokes on an aligner-word, fall back to the original transcript
    # with placeholders replaced by "_". Defensive — phonetic_normalize already
    # routes through _clean_for_aligner.
    try:
        tokenized = tokenizer(align_words)
    except KeyError as e:
        print(json.dumps({"error": f"tokenizer rejected character {e!s}; phonetic normalisation missed a case"}), file=sys.stderr)
        sys.exit(2)

    token_spans = aligner(emission_cpu[0], tokenized)
    if len(token_spans) != len(align_words):
        print(json.dumps({"error": f"aligner returned {len(token_spans)} spans for {len(align_words)} words"}), file=sys.stderr)
        sys.exit(2)

    n_frames = emission.shape[1]
    duration_s = waveform.shape[-1] / sr
    ms_per_frame = (duration_s * 1000.0) / n_frames

    # ── 4. Re-group aligner spans back into display words ──────────────────
    # Walk token_spans in order, consuming `word_to_subcount[idx]` spans per
    # display word. Placeholders (subcount=0) are skipped on the cursor and
    # fall through to the synthetic-timing branch below.
    words: list[dict] = []
    unaligned_count = 0
    last_end_ms = 0
    cursor = 0
    for idx, n_sub in enumerate(word_to_subcount):
        group = token_spans[cursor : cursor + n_sub] if n_sub > 0 else []
        cursor += n_sub

        is_placeholder = idx in placeholder_indices
        good_subs = [s for s in group if s]
        if is_placeholder or not good_subs:
            unaligned_count += 1
            words.append({
                "word": display_words[idx],          # legacy alias for `display`
                "source": display_words[idx],
                "display": display_words[idx],
                "phonetic": per_word_phonetics[idx],
                "trailing_punct": trailing_puncts[idx],
                "start_ms": last_end_ms,
                "end_ms":   last_end_ms,
                "confidence": 0.0,
                "aligned": False,
            })
            continue

        # Flatten all sub-spans across the group → one start/end pair.
        all_spans = [s for sub in good_subs for s in sub]
        start_frame = min(s.start for s in all_spans)
        end_frame = max(s.end for s in all_spans)
        confidence = float(sum(s.score for s in all_spans) / len(all_spans))
        start_ms = int(start_frame * ms_per_frame)
        end_ms = int(end_frame * ms_per_frame)

        words.append({
            "word": display_words[idx],
            "source": display_words[idx],
            "display": display_words[idx],
            "phonetic": per_word_phonetics[idx],
            "trailing_punct": trailing_puncts[idx],
            "start_ms": start_ms,
            "end_ms":   end_ms,
            "confidence": round(confidence, 4),
            "aligned": True,
        })
        last_end_ms = end_ms

    # ── 5. Librosa onset refinement ────────────────────────────────────────
    # Snap aligned word starts to the nearest librosa-detected onset within
    # ±50 ms. Materially tightens timing for sung-vs-spoken transitions and
    # cuts the "early word" artifact MMS_FA sometimes produces.
    if refine_onsets and words:
        ctx.progress(0.85, "refining word onsets via librosa")
        y_for_onset, _ = _load_audio_np(vocals_path, target_sr=sr)
        # hop_length 512 at 16 kHz → ~32 ms per onset frame.
        onset_frames = librosa.onset.onset_detect(y=y_for_onset, sr=sr, units="frames", hop_length=512)
        onset_times_ms = (onset_frames * 512 / sr) * 1000.0
        snap_window_ms = 50
        for w in words:
            if not w["aligned"]:
                continue
            target = w["start_ms"]
            diffs = onset_times_ms - target
            within = abs(diffs) <= snap_window_ms
            if within.any():
                snapped = int(onset_times_ms[within][abs(diffs[within]).argmin()])
                w["start_ms"] = snapped

    # ── 6. Phrases: re-group words by lyric line ───────────────────────────
    phrases: list[dict] = []
    cursor = 0
    for ll, pl in zip(display_lines, lyric_lines_raw):
        n = len(ll)
        if n == 0:
            continue
        chunk = words[cursor : cursor + n]
        if not chunk:
            break
        phrases.append({
            "text": pl,
            "start_ms": chunk[0]["start_ms"],
            "end_ms":   chunk[-1]["end_ms"],
            "word_idx_start": cursor,
            "word_idx_end":   cursor + n - 1,
        })
        cursor += n

    # ── 7. Aggregate mismatch signal ───────────────────────────────────────
    # Per-word confidence is easy to ignore; when most of the words are weak
    # the real story is usually "these lyrics are not what is sung" (wrong
    # version of the song, ad-libs, paraphrased lines). Surface that as a
    # top-level warning so callers can't mistake a bad alignment for a good one.
    low_conf_count = sum(1 for w in words if w["aligned"] and w["confidence"] < 0.5)
    low_conf_ratio = round(low_conf_count / len(words), 4) if words else 0.0
    warnings: list[str] = []
    if len(words) >= 10 and low_conf_ratio > 0.4:
        warnings.append(
            f"{low_conf_count} of {len(words)} words ({low_conf_ratio:.0%}) aligned with "
            "confidence < 0.5. The lyrics likely do not match what is actually sung "
            "(wrong song version, ad-libs, or paraphrased lines). Timings may still "
            "land roughly, but verify against the audio - or transcribe the track "
            "(app-transcribe / the transcribe service) and diff it against your lyrics."
        )

    ctx.progress(1.0, "done")
    ctx.set_output({
        "words": words,
        "phrases": phrases,
        "warnings": warnings,
        "metadata": {
            "duration_ms": int(duration_s * 1000),
            "sample_rate": sr,
            "used_demucs": not skip_demucs,
            "refined_onsets": refine_onsets,
            "unaligned_count": unaligned_count,
            "low_confidence_count": low_conf_count,
            "low_confidence_ratio": low_conf_ratio,
        },
    })


if __name__ == "__main__":
    main()
