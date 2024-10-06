<#
.SYNOPSIS
    Envía texto a una ventana específica utilizando su handle de ventana (hWnd).

.DESCRIPTION
    Este script activa una ventana específica identificada por su handle de ventana (hWnd) y envía el texto proporcionado a dicha ventana. 

.USAGE
    .\EnviarTexto.ps1 -hWnd <handle_de_ventana> -Texto "<texto>"

.PARAMETER hWnd
    El handle de la ventana (hWnd) a la que se enviará el texto. Debe ser un número entero que representa el handle de la ventana.

.PARAMETER Texto
    El texto que se enviará a la ventana especificada.

.EXAMPLE
    .\EnviarTexto.ps1 -hWnd 328670 -Texto "Hola Mundo"

.NOTES
    Requiere PowerShell 5.0 o superior.
#>

param (
    [Parameter(Mandatory = $true, Position = 0, HelpMessage = "Handle de la ventana (hWnd) a la que se enviará el texto.")]
    [int]$hWnd,

    [Parameter(Mandatory = $false, Position = 1, HelpMessage = "Texto a enviar a la ventana especificada.")]
    [string]$Texto
)


if (-not $Texto) {
    exit 0
}


# Función para agregar métodos de User32.dll
function Add-User32Functions {
    Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class User32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
"@ -ErrorAction Stop
}

# Agrega las funciones de User32
Add-User32Functions

# Convierte el handle a IntPtr
$hWndPtr = [IntPtr]$hWnd

# Intenta activar la ventana de destino
$exito = [User32]::SetForegroundWindow($hWndPtr)

if (-not $exito) {
    Write-Error "No se pudo activar la ventana con hWnd $hWnd."
    exit 1
}

# Espera hasta que la ventana esté activa (máximo 2 segundos)
$timeout = 2000 # milisegundos
$intervalo = 25 # milisegundos
$tiempoTranscurrido = 0

while ($tiempoTranscurrido -lt $timeout) {
    $ventanaActiva = [User32]::GetForegroundWindow()
    if ($ventanaActiva -eq $hWndPtr) {
        break
    }
    Start-Sleep -Milliseconds $intervalo
    $tiempoTranscurrido += $intervalo
}



if ($tiempoTranscurrido -ge $timeout) {
    Write-Error "No se pudo activar la ventana con hWnd $hWnd dentro del tiempo de espera."
    exit 1
}




# Carga el ensamblado necesario para enviar las teclas
Add-Type -AssemblyName System.Windows.Forms

# Envía el texto utilizando SendKeys
[System.Windows.Forms.SendKeys]::SendWait($Texto)

# Finaliza el script
exit 0
