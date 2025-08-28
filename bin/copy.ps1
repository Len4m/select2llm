#Requires -Version 5.1
<#
.SYNOPSIS
    Captures the active window handle and executes copy command
.DESCRIPTION
    Gets the handle of the currently active window, sends Ctrl+C, and returns the handle
.OUTPUTS
    String - The window handle of the active window
#>

[CmdletBinding()]
param()

# Error handling preference
$ErrorActionPreference = 'Stop'

try {
    # Define Win32 API functions in a more robust way
    if (-not ([System.Management.Automation.PSTypeName]'WindowsAPI.User32').Type) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace WindowsAPI {
    public static class User32 {
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr GetForegroundWindow();
        
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsWindow(IntPtr hWnd);
        
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsWindowVisible(IntPtr hWnd);
    }
}
"@ -ErrorAction Stop
    }

    # Get the active window handle
    $activeWindowHandle = [WindowsAPI.User32]::GetForegroundWindow()
    
    # Validate window handle
    if ($activeWindowHandle -eq [IntPtr]::Zero) {
        throw "No active window found"
    }
    
    if (-not [WindowsAPI.User32]::IsWindow($activeWindowHandle)) {
        throw "Invalid window handle"
    }
    
    if (-not [WindowsAPI.User32]::IsWindowVisible($activeWindowHandle)) {
        throw "Window is not visible"
    }

    # Execute copy command with error handling
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        [System.Windows.Forms.SendKeys]::SendWait('^c')
        
        # Small delay to ensure copy operation completes
        Start-Sleep -Milliseconds 50
    }
    catch {
        throw "Failed to execute copy command: $($_.Exception.Message)"
    }

    # Output the window handle as integer (not hex)
    Write-Output $activeWindowHandle.ToInt64()
}
catch {
    Write-Error "Copy operation failed: $($_.Exception.Message)" -ErrorAction Stop
    exit 1
}