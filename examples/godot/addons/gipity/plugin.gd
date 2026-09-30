@tool
extends EditorPlugin

const AUTOLOAD := "Gipity"
const SETTINGS := {
	"gipity/app_guid": "",
	"gipity/api_base": "https://a.gipity.ai",
}


func _enable_plugin() -> void:
	add_autoload_singleton(AUTOLOAD, "res://addons/gipity/gipity.gd")
	for key in SETTINGS:
		if not ProjectSettings.has_setting(key):
			ProjectSettings.set_setting(key, SETTINGS[key])
		ProjectSettings.set_initial_value(key, SETTINGS[key])
	ProjectSettings.save()


func _disable_plugin() -> void:
	remove_autoload_singleton(AUTOLOAD)
