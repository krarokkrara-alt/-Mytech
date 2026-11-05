Option Explicit
Dim fso, shell, folder, exe, script
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
exe = fso.BuildPath(folder, ".tools\node-v24.11.1-win-x64\node.exe")
script = fso.BuildPath(folder, "my-tech-accounting\launch.mjs")
If Not fso.FileExists(exe) Then
  MsgBox "Please extract the complete MY TECH folder before opening.", 48, "MY TECH"
Else
  shell.Run Chr(34) & exe & Chr(34) & " " & Chr(34) & script & Chr(34), 0, False
End If
