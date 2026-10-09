$ErrorActionPreference = 'Stop'
$templateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$archivePath = Join-Path (Split-Path $templateRoot -Parent) 'Shirone-Blog-Template.zip'
if (Test-Path -LiteralPath $archivePath) { throw 'Archive already exists; move the previous ZIP before repackaging.' }
$fileJson = & node (Join-Path $PSScriptRoot 'check.mjs') --list
if ($LASTEXITCODE -ne 0) { throw 'Release checks failed.' }
$files = $fileJson | ConvertFrom-Json
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew)
$archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($relative in $files) {
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $templateRoot $relative))
    if (-not $sourcePath.StartsWith($templateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped template root.' }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $sourcePath, ('Shirone-Blog-Template/' + $relative), [IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Output "Created $archivePath ($($files.Count) files)"
