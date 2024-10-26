<#
.SYNOPSIS
    Envía texto a una ventana específica utilizando su handle de ventana (hWnd).

.DESCRIPTION
    Este script puede enviar texto a una ventana o control específico utilizando diferentes métodos: SendKeys, SendInput o SendMessage.

.PARAMETER hWnd
    El handle de la ventana (hWnd) a la que se enviará el texto.

.PARAMETER Texto
    El texto que se enviará a la ventana especificada.

.PARAMETER Metodo
    El método a utilizar para enviar el texto. Valores permitidos: 'SendKeys', 'SendInput', 'SendMessage'. Por defecto es 'SendKeys'.

.EXAMPLE
    .\EnviarTexto.ps1 -hWnd 328670 -Texto "Hola Mundo" -Metodo SendInput
#>

param (
    [Parameter(Mandatory = $true, Position = 0, HelpMessage = "Handle de la ventana (hWnd) a la que se enviará el texto.")]
    [int]$hWnd,

    [Parameter(Mandatory = $false, Position = 1, HelpMessage = "Texto a enviar a la ventana especificada.")]
    [string]$Texto,

    [Parameter(Mandatory = $false, HelpMessage = "Método para enviar el texto: 'SendKeys', 'SendInput', 'SendMessage'.")]
    [ValidateSet("SendKeys", "SendInput", "SendMessage")]
    [string]$Metodo = "SendKeys"
)

if (-not $Texto) {
    exit 0
}

function Add-User32Functions {
    Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class MyUser32 {
    public delegate bool EnumChildProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT {
        public uint type;
        public InputUnion U;
        public static int Size
        {
            get { return Marshal.SizeOf(typeof(INPUT)); }
        }
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct InputUnion {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct HARDWAREINPUT {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, string lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumChildWindows(IntPtr hWndParent, EnumChildProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    public const int WM_SETTEXT = 0x000C;
}
"@ -ErrorAction Stop
}

# Agrega las funciones de MyUser32
Add-User32Functions

# Convierte el handle a IntPtr
$hWndPtr = [IntPtr]$hWnd

switch ($Metodo) {
    "SendKeys" {
        # Activa la ventana
        [MyUser32]::SetForegroundWindow($hWndPtr) | Out-Null

        # Envía el texto con SendKeys
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.SendKeys]::SendWait($Texto)
    }
    "SendInput" {
        # Activa la ventana
        [MyUser32]::SetForegroundWindow($hWndPtr) | Out-Null

        # Función para enviar texto utilizando SendInput
        function Send-InputText {
            param ([string]$text)
            $inputs = @()

            # Convierte la cadena en puntos de código Unicode completos
            $enumerator = [System.Globalization.StringInfo]::GetTextElementEnumerator($text)
            while ($enumerator.MoveNext()) {
                $textElement = $enumerator.GetTextElement()
                $codePoints = [char[]]$textElement | ForEach-Object { [int]$_ }

                foreach ($codePoint in $codePoints) {
                    $vk = [uint16]$codePoint

                    # Tecla abajo
                    $inputDown = New-Object MyUser32+INPUT
                    $inputDown.type = 1  # INPUT_KEYBOARD
                    $inputDown.U.ki.wVk = 0
                    $inputDown.U.ki.wScan = $vk
                    $inputDown.U.ki.dwFlags = 0x0004  # KEYEVENTF_UNICODE
                    $inputs += $inputDown

                    # Tecla arriba
                    $inputUp = New-Object MyUser32+INPUT
                    $inputUp.type = 1  # INPUT_KEYBOARD
                    $inputUp.U.ki.wVk = 0
                    $inputUp.U.ki.wScan = $vk
                    $inputUp.U.ki.dwFlags = 0x0004 -bor 0x0002  # KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
                    $inputs += $inputUp
                }
            }

            # Envía todos los inputs
            [MyUser32]::SendInput($inputs.Count, $inputs, [MyUser32+INPUT]::Size) | Out-Null
        }

        # Envía el texto utilizando SendInput
        Send-InputText -text $Texto
    }
    "SendMessage" {
        # Variable para almacenar el handle del control Edit
        $editHandle = [IntPtr]::Zero

        # Define el delegado para EnumChildWindows
        $callback = [MyUser32+EnumChildProc]{
            param($hwndChild, $lParam)
            $className = New-Object System.Text.StringBuilder 256
            [MyUser32]::GetClassName($hwndChild, $className, $className.Capacity) | Out-Null
            if ($className.ToString() -eq "Edit") {
                $script:editHandle = $hwndChild
                return $false  # Detiene la enumeración
            }
            return $true  # Continúa la enumeración
        }

        # Enumera los controles hijos para encontrar el control Edit
        [MyUser32]::EnumChildWindows($hWndPtr, $callback, [IntPtr]::Zero) | Out-Null

        if ($editHandle -eq [IntPtr]::Zero) {
            Write-Error "No se encontró un control de texto (Edit) en la ventana con hWnd $hWnd."
            exit 1
        }

        # Envía el mensaje WM_SETTEXT al control Edit para establecer el texto
        [MyUser32]::SendMessage($editHandle, [MyUser32]::WM_SETTEXT, [IntPtr]::Zero, $Texto)
    }
}

# Finaliza el script
exit 0
