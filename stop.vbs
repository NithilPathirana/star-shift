' Stop the local site + relay started by start.vbs (no console window).
' AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
Option Explicit
Dim wmi, p
Set wmi = GetObject("winmgmts:")
For Each p In wmi.ExecQuery("SELECT * FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%server.mjs%'")
  p.Terminate
Next
