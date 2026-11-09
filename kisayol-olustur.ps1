# Creates a double-clickable game shortcut on the desktop.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = "Agent World.lnk"
$link = Join-Path ([Environment]::GetFolderPath('Desktop')) $name
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = "$env:WINDIR\System32\wscript.exe"
$s.Arguments = "`"$root\baslat.vbs`""
$s.WorkingDirectory = $root
$s.IconLocation = "$root\panel\favicon.ico,0"
$s.Description = 'Starts the game and opens the panel in its own window'
$s.Save()
Write-Output "Shortcut created: $link"
