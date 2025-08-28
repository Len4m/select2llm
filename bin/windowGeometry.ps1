#Requires -Version 5.1
<#
.SYNOPSIS
    Gets window geometry information for a specified window handle
.DESCRIPTION
    Retrieves position and size information for a window and returns it as JSON
.PARAMETER hwnd
    Window handle (hWnd) - supports decimal or hexadecimal format (0x prefix)
.OUTPUTS
    JSON object with x, y, width, height properties
.EXAMPLE
    .\windowGeometry.ps1 -hwnd 123456
    .\windowGeometry.ps1 -hwnd 0x1E240
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateNotNullOrEmpty()]
    [string]$hwnd
)

# Error handling preference
$ErrorActionPreference = 'Stop'

try {
    # Define Win32 API functions once
    if (-not ([System.Management.Automation.PSTypeName]'WindowGeometry.Win32').Type) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace WindowGeometry {
    public static class Win32 {
        [StructLayout(LayoutKind.Sequential)]
        public struct RECT {
            public int Left;        
            public int Top;         
            public int Right;       
            public int Bottom;      
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
        
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsWindow(IntPtr hWnd);
        
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsWindowVisible(IntPtr hWnd);
    }
}
"@ -ErrorAction Stop
    }

    # Convert hwnd to IntPtr, supporting both decimal and hexadecimal
    $hwndInt = if ($hwnd.StartsWith("0x")) {
        [IntPtr]::new([Convert]::ToInt64($hwnd, 16))
    } else {
        [IntPtr]::new([Convert]::ToInt64($hwnd))
    }
    
    # Validate window handle
    if ($hwndInt -eq [IntPtr]::Zero) {
        throw "Invalid window handle: handle cannot be zero"
    }
    
    if (-not [WindowGeometry.Win32]::IsWindow($hwndInt)) {
        throw "Invalid window handle: $hwnd is not a valid window"
    }
    
    Write-Verbose "Getting geometry for window handle: $hwnd"
    
    # Get window rectangle
    $rect = New-Object WindowGeometry.Win32+RECT
    $success = [WindowGeometry.Win32]::GetWindowRect($hwndInt, [ref]$rect)
    
    if (-not $success) {
        $lastError = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "Failed to get window rectangle. Win32 Error: $lastError"
    }
    
    # Calculate dimensions and create result object
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    
    # Validate dimensions
    if ($width -le 0 -or $height -le 0) {
        Write-Warning "Window has invalid dimensions: ${width}x${height}"
    }
    
    $geometry = @{
        x = $rect.Left
        y = $rect.Top
        width = $width
        height = $height
        visible = [WindowGeometry.Win32]::IsWindowVisible($hwndInt)
    }
    
    Write-Verbose "Window geometry retrieved: $($geometry | ConvertTo-Json -Compress)"
    
    # Output as JSON
    $geometry | ConvertTo-Json -Compress
    exit 0
}
catch {
    Write-Error "Failed to get window geometry: $($_.Exception.Message)" -ErrorAction Stop
    exit 1
}
