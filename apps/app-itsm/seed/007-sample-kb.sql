-- 007-sample-kb.sql
-- Sample knowledge base articles

INSERT INTO knowledge_articles (title, body, category, state, visibility) VALUES
(
    'How to Reset Your Password',
    '<h2>Password Reset Guide</h2>
<p>Follow these steps to reset your password for the company network.</p>

<h3>Self-Service Reset</h3>
<ol>
    <li>Go to <code>https://password.company.com</code></li>
    <li>Click "Forgot Password"</li>
    <li>Enter your email address</li>
    <li>Check your email for the reset link (check spam folder if not received within 5 minutes)</li>
    <li>Click the link and set a new password</li>
</ol>

<h3>Password Requirements</h3>
<ul>
    <li>Minimum 12 characters</li>
    <li>At least one uppercase letter</li>
    <li>At least one number</li>
    <li>At least one special character</li>
    <li>Cannot reuse your last 5 passwords</li>
</ul>

<h3>If Self-Service Does Not Work</h3>
<p>Contact the Service Desk by submitting an incident with the category <strong>Access &amp; Permissions &gt; Password Reset</strong>. Include the system you need access to and your username.</p>',
    'Access & Permissions',
    'published',
    'public'
),
(
    'VPN Setup Guide',
    '<h2>VPN Connection Setup</h2>
<p>This guide covers how to set up and troubleshoot the company VPN connection.</p>

<h3>Initial Setup</h3>
<ol>
    <li>Download the VPN client from <code>https://vpn.company.com/download</code></li>
    <li>Install the application (admin rights required)</li>
    <li>Launch the VPN client</li>
    <li>Enter the server address: <code>vpn.company.com</code></li>
    <li>Log in with your network credentials</li>
    <li>Complete the MFA prompt on your authenticator app</li>
</ol>

<h3>Troubleshooting</h3>
<ul>
    <li><strong>Connection drops frequently:</strong> Try switching between Wi-Fi and a wired connection. Check if your ISP is blocking VPN ports.</li>
    <li><strong>Cannot authenticate:</strong> Ensure your password has not expired. Try a password reset first.</li>
    <li><strong>Slow performance:</strong> Switch from Full Tunnel to Split Tunnel mode in the VPN client settings (if permitted by your access level).</li>
    <li><strong>DNS resolution failures:</strong> Flush your DNS cache: run <code>ipconfig /flushdns</code> (Windows) or <code>sudo dscacheutil -flushcache</code> (Mac).</li>
</ul>

<h3>Request VPN Access</h3>
<p>If you do not have VPN access, request it through the <strong>Service Catalog &gt; VPN Access</strong> item. Manager approval is required.</p>',
    'Network',
    'published',
    'public'
),
(
    'How to Request New Software',
    '<h2>Software Request Process</h2>
<p>All software installations must go through the IT request process to ensure license compliance and security.</p>

<h3>Approved Software (No Approval Needed)</h3>
<p>The following software can be installed immediately via the Service Catalog:</p>
<ul>
    <li>Google Chrome / Mozilla Firefox</li>
    <li>Slack Desktop</li>
    <li>Zoom</li>
    <li>Visual Studio Code</li>
    <li>7-Zip</li>
    <li>Adobe Acrobat Reader</li>
</ul>

<h3>How to Request</h3>
<ol>
    <li>Go to the <strong>Service Catalog</strong></li>
    <li>Select <strong>Software Installation</strong></li>
    <li>Enter the software name and version</li>
    <li>If you have a license key, include it in the form</li>
    <li>Submit the request</li>
</ol>

<h3>Software Not on the Approved List</h3>
<p>If the software you need is not on the pre-approved list, the request will be routed to the Security team for review. This typically takes 3-5 business days. Be prepared to provide a business justification.</p>

<h3>License Management</h3>
<p>Do not purchase software licenses independently. All licenses must be procured through IT to ensure volume discounts and compliance tracking.</p>',
    'Software',
    'published',
    'public'
),
(
    'Wi-Fi Troubleshooting',
    '<h2>Wi-Fi Troubleshooting Guide</h2>
<p>Common solutions for wireless connectivity issues in the office.</p>

<h3>Quick Fixes</h3>
<ol>
    <li><strong>Toggle Wi-Fi off and on</strong> on your device</li>
    <li><strong>Forget the network</strong> and reconnect (select "CorpWiFi" and enter your credentials)</li>
    <li><strong>Restart your device</strong> - this resolves most connectivity issues</li>
    <li><strong>Move closer to an access point</strong> - walls and large metal objects reduce signal</li>
</ol>

<h3>Network Names</h3>
<ul>
    <li><code>CorpWiFi</code> - Primary corporate network (use your network credentials)</li>
    <li><code>CorpGuest</code> - Guest network (limited access, no internal resources)</li>
    <li><code>CorpIOT</code> - IoT devices only (not for laptops/phones)</li>
</ul>

<h3>Certificate Errors</h3>
<p>If you see a certificate warning when connecting:</p>
<ol>
    <li>Ensure your device date and time are correct</li>
    <li>Check that your device has the latest OS updates</li>
    <li>If the issue persists, your device certificate may need renewal - contact the Service Desk</li>
</ol>

<h3>Still Not Working?</h3>
<p>Submit an incident with category <strong>Network &gt; Wi-Fi</strong>. Include your device type, operating system, the building/floor you are on, and any error messages you see.</p>',
    'Network',
    'published',
    'public'
);
