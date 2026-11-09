' Oyunu konsol penceresi göstermeden başlatır.
Option Explicit
Dim shell, fso, dir, code
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
On Error Resume Next
code = shell.Run("node """ & dir & "\launcher.js""", 0, True)
If Err.Number <> 0 Then
  MsgBox "Node.js bulunamadi. Node.js 20 veya ustunu kurup tekrar dene.", 16, "Ajan Dunyasi"
ElseIf code <> 0 Then
  MsgBox "Oyun baslatilamadi. Ayrinti icin kayit klasorundeki oyun.log dosyasina bak.", 16, "Ajan Dunyasi"
End If
