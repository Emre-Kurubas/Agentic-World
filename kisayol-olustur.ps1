# Masaustune cift tiklanabilir oyun kisayolu olusturur.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = "Ajan D$([char]0xFC)nyas$([char]0x131).lnk"
$link = Join-Path ([Environment]::GetFolderPath('Desktop')) $name
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($link)
$s.TargetPath = "$env:WINDIR\System32\wscript.exe"
$s.Arguments = "`"$root\baslat.vbs`""
$s.WorkingDirectory = $root
$s.IconLocation = "$root\panel\favicon.ico,0"
$s.Description = 'Oyunu baslatir ve paneli kendi penceresinde acar'
$s.Save()
Write-Output "Kisayol olusturuldu: $link"
