$w = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -match 'com\.winsle\.app' }
$ids = @($w.ProcessId) + (Get-Process winsle).Id
$p = Get-Process -Id $ids
$p | Select Name, Id, @{n='WS_MB';e={[math]::Round($_.WorkingSet64/1MB,1)}}, @{n='Priv_MB';e={[math]::Round($_.PrivateMemorySize64/1MB,1)}}, CPU | Format-Table -Auto | Out-String
"TOTAL WS MB: " + [math]::Round(($p | Measure WorkingSet64 -Sum).Sum/1MB,1)
"TOTAL Private MB: " + [math]::Round(($p | Measure PrivateMemorySize64 -Sum).Sum/1MB,1)
