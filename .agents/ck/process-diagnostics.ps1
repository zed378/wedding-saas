Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','rtk.exe','powershell.exe') } | Select-Object ProcessId, ParentProcessId, Name, CommandLine | Format-Table -Wrap
Get-CimInstance Win32_OperatingSystem | Select-Object FreePhysicalMemory, TotalVisibleMemorySize
