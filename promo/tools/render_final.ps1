# Runs promo/tools/render_final.sh while asking Windows not to idle-sleep (SetThreadExecutionState,
# the same per-process request a video player makes; no power settings are changed). The request ends
# with this process. A closed lid or a manual Sleep still stops the render; run again to resume.
#   powershell -ExecutionPolicy Bypass -File promo/tools/render_final.ps1
Add-Type -Namespace Win32 -Name Power -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);'
$ES_CONTINUOUS = [uint32]"0x80000000"; $ES_SYSTEM_REQUIRED = [uint32]"0x00000001"
[Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED) | Out-Null
try {
  $bash = "C:\Program Files\Git\bin\bash.exe"
  & $bash (Join-Path $PSScriptRoot "render_final.sh")
} finally {
  [Win32.Power]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
}
