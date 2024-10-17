param (
    [Parameter(Mandatory = $true)]
    [string]$hwnd
)

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class Win32Functions {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;        
        public int Top;         
        public int Right;       
        public int Bottom;      
    }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
"@

# Convertir el hwnd a IntPtr, aceptando formato hexadecimal o decimal
try {
    if ($hwnd.StartsWith("0x")) {
        $hwndInt = [IntPtr]::new([Convert]::ToInt32($hwnd, 16))
    } else {
        $hwndInt = [IntPtr]::new([Convert]::ToInt32($hwnd))
    }
} catch {
    Write-Error "El hwnd proporcionado no es válido."
    exit
}

$rect = New-Object Win32Functions+RECT
$result = [Win32Functions]::GetWindowRect($hwndInt, [ref]$rect)

if ($result) {
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    $jsonObject = @{
        x = $rect.Left
        y = $rect.Top
        width = $width
        height = $height
    } | ConvertTo-Json

    Write-Output $jsonObject
} else {
    Write-Error "No se pudo obtener la información de la ventana con hwnd $hwnd."
}
