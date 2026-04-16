Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = "E:\Downloads\Polling-Stations-Results-Brazil-2006-2024-main.zip"
$extractPath = "c:\Users\lixov\OneDrive\Documentos\Observatorio\external_scripts"
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$entry = $zip.Entries | Where-Object { $_.FullName -like "*map-render.js" }
foreach ($e in $entry) {
    $target = Join-Path $extractPath $e.Name
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($e, $target, $true)
}
$zip.Dispose()
