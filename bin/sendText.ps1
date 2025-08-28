#Requires -Version 5.1
<#
.SYNOPSIS
    Sends text to a specific window using optimized Unicode input
.DESCRIPTION
    Sends text to a window using SendInput for fast, reliable Unicode text input.
    Supports emojis, special characters, and UTF-8 without escaping issues.
.PARAMETER hWnd
    Window handle (hWnd) to send text to
.PARAMETER Texto
    Text to send to the specified window (raw text, no escaping needed)
.EXAMPLE
    .\sendText.ps1 -hWnd 328670 -Texto "Hello 🌍 World!"
#>

[CmdletBinding()]
param (
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateRange(1, [int64]::MaxValue)]
    [int64]$hWnd,

    [Parameter(Mandatory = $false, Position = 1)]
    [AllowEmptyString()]
    [string]$Texto = ""
)

# Error handling preference
$ErrorActionPreference = 'Stop'

# Early exit if no text to send
if ([string]::IsNullOrEmpty($Texto)) {
    Write-Verbose "No text provided, exiting"
    exit 0
}

# Define optimized Win32 API for fast Unicode input
if (-not ([System.Management.Automation.PSTypeName]'FastTextInput.Win32').Type) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace FastTextInput {
    public static class Win32 {
        // Window functions
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsWindow(IntPtr hWnd);
        
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool IsWindowVisible(IntPtr hWnd);
        
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SetForegroundWindow(IntPtr hWnd);
        
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr GetFocus();
        
        // SendMessage for direct text sending
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, string lParam);
        
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
        
        // SendInput structures for Unicode
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT {
            public uint type;
            public InputUnion U;
            public static int Size {
                get { return Marshal.SizeOf(typeof(INPUT)); }
            }
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion {
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
        
        // Constants
        public const uint INPUT_KEYBOARD = 1;
        public const uint KEYEVENTF_UNICODE = 0x0004;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint WM_SETTEXT = 0x000C;
        public const uint WM_CHAR = 0x0102;
        public const uint WM_PASTE = 0x0302;
    }
}
"@ -ErrorAction Stop
}

# Function to escape text for SendKeys
function Escape-ForSendKeys {
    param([string]$inputText)
    
    if ([string]::IsNullOrEmpty($inputText)) {
        return ""
    }
    
    # Replace line breaks and tabs
    $escaped = $inputText -replace '\r\n|\n|\r', '{ENTER}'
    $escaped = $escaped -replace '\t', '{TAB}'
    
    # Escape special SendKeys characters
    $escaped = $escaped -replace '\+', '{+}'
    $escaped = $escaped -replace '\^', '{^}'
    $escaped = $escaped -replace '%', '{%}'
    $escaped = $escaped -replace '~', '{~}'
    $escaped = $escaped -replace '\{', '{{}'
    $escaped = $escaped -replace '\}', '{}}'
    $escaped = $escaped -replace '\[', '{[}'
    $escaped = $escaped -replace '\]', '{]}'
    $escaped = $escaped -replace '\(', '{(}'
    $escaped = $escaped -replace '\)', '{)}'
    
    return $escaped
}

# Try to send text directly to window without focusing (faster)
function Send-DirectText {
    param([IntPtr]$windowHandle, [string]$text)
    
    try {
        Write-Verbose "Attempting direct text sending to window handle: $windowHandle"
        
        # Method 1: Try WM_SETTEXT (replaces all text)
        Write-Verbose "Trying WM_SETTEXT method..."
        $result = [FastTextInput.Win32]::SendMessage($windowHandle, [FastTextInput.Win32]::WM_SETTEXT, [IntPtr]::Zero, $text)
        Write-Verbose "WM_SETTEXT result: $result"
        
        if ($result -ne [IntPtr]::Zero) {
            Write-Verbose "WM_SETTEXT appeared to succeed, but this doesn't guarantee text insertion"
            # Don't trust WM_SETTEXT success - many controls return success but don't actually insert text
        }
        
        # Method 2: Try character-by-character with WM_CHAR (more reliable for input fields)
        Write-Verbose "Trying WM_CHAR method for more reliable text insertion..."
        $charsSent = 0
        foreach ($char in $text.ToCharArray()) {
            $result = [FastTextInput.Win32]::SendMessage($windowHandle, [FastTextInput.Win32]::WM_CHAR, [IntPtr]::new([int]$char), [IntPtr]::Zero)
            if ($result -ne [IntPtr]::Zero) {
                $charsSent++
            }
        }
        
        if ($charsSent -eq $text.Length) {
            Write-Verbose "WM_CHAR method sent all $charsSent characters successfully"
            return $true
        } else {
            Write-Verbose "WM_CHAR method only sent $charsSent of $($text.Length) characters"
        }
        
        # Both methods are unreliable for many modern applications
        # Return false to force fallback to SendKeys which is more reliable
        Write-Verbose "Direct methods are unreliable, forcing fallback to SendKeys for better compatibility"
        return $false
    }
    catch {
        Write-Verbose "Direct text sending failed with exception: $($_.Exception.Message)"
        return $false
    }
}

# Robust function to send Unicode text using SendInput (completely safe, no escaping needed)
function Send-UnicodeText {
    param([string]$text)
    
    if ([string]::IsNullOrEmpty($text)) { 
        Write-Verbose "Empty text provided to Send-UnicodeText"
        return 0 
    }
    
    Write-Verbose "Processing $($text.Length) characters for Unicode SendInput"
    
    try {
        # Process text using StringInfo to handle complex Unicode characters properly
        # This correctly handles emojis, combining characters, and surrogate pairs
        $inputs = @()
        $textElements = [System.Globalization.StringInfo]::new($text)
        $elementCount = $textElements.LengthInTextElements
        
        Write-Verbose "Text contains $elementCount Unicode text elements"
        
        for ($i = 0; $i -lt $elementCount; $i++) {
            $element = $textElements.SubstringByTextElements($i, 1)
            
            # Process each UTF-16 code unit in the element
            foreach ($char in $element.ToCharArray()) {
                $unicode = [int]$char
                
                # Skip control characters except for common ones like tab and newline
                if ($unicode -lt 32 -and $unicode -ne 9 -and $unicode -ne 10 -and $unicode -ne 13) {
                    Write-Verbose "Skipping control character: $unicode"
                    continue
                }
                
                # Create key down event
                $inputDown = New-Object FastTextInput.Win32+INPUT
                $inputDown.type = [FastTextInput.Win32]::INPUT_KEYBOARD
                $inputDown.U.ki.wVk = 0
                $inputDown.U.ki.wScan = $unicode
                $inputDown.U.ki.dwFlags = [FastTextInput.Win32]::KEYEVENTF_UNICODE
                $inputDown.U.ki.time = 0
                $inputDown.U.ki.dwExtraInfo = [IntPtr]::Zero
                $inputs += $inputDown
                
                # Create key up event
                $inputUp = New-Object FastTextInput.Win32+INPUT
                $inputUp.type = [FastTextInput.Win32]::INPUT_KEYBOARD
                $inputUp.U.ki.wVk = 0
                $inputUp.U.ki.wScan = $unicode
                $inputUp.U.ki.dwFlags = ([FastTextInput.Win32]::KEYEVENTF_UNICODE -bor [FastTextInput.Win32]::KEYEVENTF_KEYUP)
                $inputUp.U.ki.time = 0
                $inputUp.U.ki.dwExtraInfo = [IntPtr]::Zero
                $inputs += $inputUp
            }
        }
        
        if ($inputs.Count -eq 0) { 
            Write-Verbose "No valid input events generated"
            return 0 
        }
        
        Write-Verbose "Generated $($inputs.Count) input events"
        
        # Send inputs in optimal batches for performance and reliability
        $batchSize = 50  # Smaller batches for better reliability
        $totalSent = 0
        $batchCount = [Math]::Ceiling($inputs.Count / $batchSize)
        
        for ($i = 0; $i -lt $inputs.Count; $i += $batchSize) {
            $batchNumber = [Math]::Floor($i / $batchSize) + 1
            $endIndex = [Math]::Min($i + $batchSize - 1, $inputs.Count - 1)
            $batch = $inputs[$i..$endIndex]
            
            Write-Verbose "Sending batch $batchNumber/$batchCount ($($batch.Count) events)"
            
            $sent = [FastTextInput.Win32]::SendInput($batch.Count, $batch, [FastTextInput.Win32+INPUT]::Size)
            $totalSent += $sent
            
            if ($sent -eq 0) {
                $lastError = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
                throw "SendInput failed at batch $batchNumber/$batchCount. Win32 Error: $lastError"
            }
            
            # Micro-delay between batches for stability (only if more batches to send)
            if ($endIndex -lt $inputs.Count - 1) {
                Start-Sleep -Milliseconds 2
            }
        }
        
        Write-Verbose "SendInput completed: $totalSent events sent successfully"
        return $totalSent
        
    } catch {
        Write-Verbose "Send-UnicodeText failed: $($_.Exception.Message)"
        throw
    }
}

try {
    # Convert handle to IntPtr and validate
    $hWndPtr = [IntPtr]::new($hWnd)
    
    # Validate window handle
    if (-not [FastTextInput.Win32]::IsWindow($hWndPtr)) {
        throw "Invalid window handle: $hWnd"
    }
    
    if (-not [FastTextInput.Win32]::IsWindowVisible($hWndPtr)) {
        Write-Warning "Window with handle $hWnd is not visible"
    }

    Write-Verbose "Sending text to window handle: $hWnd (length: $($Texto.Length))"
    
    # Use SendInput with Unicode as primary method (completely safe, no escaping needed)
    Write-Verbose "Using SendInput with Unicode for maximum safety and compatibility"
    
    # Activate window first
    $activationResult = [FastTextInput.Win32]::SetForegroundWindow($hWndPtr)
    if (-not $activationResult) {
        Write-Warning "Failed to activate window, but proceeding anyway"
    } else {
        Write-Verbose "Window activated successfully"
    }
    
    # Brief delay for window activation
    Start-Sleep -Milliseconds 25
    
    # Send text using SendInput with Unicode (completely safe, no escaping required)
    try {
        $eventsSent = Send-UnicodeText -text $Texto
        
        if ($eventsSent -gt 0) {
            Write-Verbose "Text sent successfully via SendInput Unicode: $eventsSent input events"
        } else {
            throw "SendInput Unicode failed - no events were sent"
        }
    }
    catch {
        Write-Verbose "SendInput Unicode failed, trying SendKeys as fallback"
        
        # Fallback: Try SendKeys with escaping
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
            
            # Escape text for SendKeys as last resort
            $escapedText = Escape-ForSendKeys -inputText $Texto
            Write-Verbose "Fallback to SendKeys with escaped text: '$escapedText'"
            
            [System.Windows.Forms.SendKeys]::SendWait($escapedText)
            Write-Verbose "Text sent successfully via SendKeys fallback"
        }
        catch {
            Write-Verbose "SendKeys also failed, trying direct method as final backup"
            
            # Final backup: Try direct method
            $directSuccess = Send-DirectText -windowHandle $hWndPtr -text $Texto
            
            if (-not $directSuccess) {
                throw "All methods failed: SendInput Unicode, SendKeys, and direct methods: $($_.Exception.Message)"
            }
            
            Write-Verbose "Direct method succeeded as final backup"
        }
    }
    
    Write-Verbose "Unicode text sending completed successfully"
    exit 0
}
catch {
    Write-Error "Text sending failed: $($_.Exception.Message)" -ErrorAction Stop
    exit 1
}
