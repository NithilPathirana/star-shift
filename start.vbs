' Start the local site + relay with no console window, then open it in the browser.
' Double-click this file. Run "start.vbs noopen" to start without opening the browser.
' AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
Option Explicit
Dim sh, fso, here, wmi, procs, url
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:8787/"
Set wmi = GetObject("winmgmts:")
Set procs = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%server.mjs%'")
If procs.Count = 0 Then
  sh.CurrentDirectory = here
  sh.Run "node server\server.mjs 8787", 0, False
  WScript.Sleep 1200
End If
If WScript.Arguments.Count = 0 Then sh.Run url
