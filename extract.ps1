Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "E:\Downloads\Polling-Stations-Results-Brazil-2006-2024-main.zip"
$extractPath = "c:\Users\lixov\OneDrive\Documentos\Observatorio\external_scripts"
if (-not (Test-Path $extractPath)) { New-Item -ItemType Directory -Path $extractPath }

$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entry = $zip.Entries | Where-Object { $_.FullName -like "*data-process.js" -or $_.FullName -like "*data-loader.js" }
foreach ($e in $entry) {
    $target = Join-Path $extractPath $e.Name
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
}
$zip.Dispose()
