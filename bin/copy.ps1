Add-Type @"
using System;
using System.Runtime.InteropServices;
public class User32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@

function Get-ActiveWindowHandle {
    # Obtiene el identificador de la ventana activa
    $hWnd = [User32]::GetForegroundWindow()
    return $hWnd
}

# Guarda el identificador de la ventana activa en una variable
$activeWindowHandle = Get-ActiveWindowHandle

# copy command
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('^c')

# Imprime el identificador de la ventana activa
Write-Output "$activeWindowHandle"