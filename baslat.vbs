' Starts the game without showing a console window.
Option Explicit
Dim shell, fso, dir, code
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
On Error Resume Next
code = shell.Run("node """ & dir & "\launcher.js""", 0, True)
If Err.Number <> 0 Then
  MsgBox "Node.js was not found. Install Node.js 20 or newer and try again.", 16, "Agent World"
ElseIf code <> 0 Then
  MsgBox "The game could not be started. See game.log in the save folder for details.", 16, "Agent World"
End If
