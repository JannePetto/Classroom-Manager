from __future__ import annotations

import asyncio
import base64
import ctypes
import getpass
import html
import json
import math
import os
from pathlib import Path
import platform
import queue
import re
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import uuid
import zlib
from ctypes import wintypes
from urllib.parse import quote, urlparse

import websockets


HEARTBEAT_INTERVAL = 30
RECONNECT_DELAY = 5
ACTIVITY_POLL_INTERVAL = 2.0
FRAME_INTERVAL = 0.2
SCREEN_PREVIEW_MAX_WIDTH = 560
SCREEN_PREVIEW_MAX_HEIGHT = 315
THUMBNAIL_INTERVAL = 30
THUMBNAIL_MAX_WIDTH = 320
THUMBNAIL_MAX_HEIGHT = 180
TEXT_INPUT_CHUNK_SIZE = 48
ENFORCEMENT_LAUNCH_GRACE_SECONDS = 20
ENFORCEMENT_REPEAT_SECONDS = 10
WEBSITE_BLOCK_DELAY_SECONDS = 10
AUTOSTART_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
AUTOSTART_NAME = "ClassroomDeviceAgent"
STATUS_FILE_NAME = "ClassroomAgentStatus.txt"
DISCOVERY_PORT = 3100
DISCOVERY_PROTOCOL = "classroom-discovery-v1"
DISCOVERY_TIMEOUT_SECONDS = 3.0
DISCOVERY_ATTEMPTS = 3
AGENT_VERSION = "2026.03.18-admin"
AGENT_STATE_DIR_NAME = "ClassroomAgent"
AGENT_ID_FILE_NAME = "agent-id.txt"
CACHED_MASTER_URL_FILE_NAME = "last-master-url.txt"
MAX_UPDATE_SIZE_BYTES = 64 * 1024 * 1024
MAX_ANNOUNCEMENT_TEXT_LENGTH = 500
AUDIO_VOLUME_CACHE_SECONDS = 5.0
POWER_ACTION_DELAY_SECONDS = 5
CLASSROOM_CONSENT_TIMEOUT_SECONDS = 30
CLASSROOM_AUDIO_ALIAS = "classroom_audio"
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
CREATE_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
INSTALL_DIR_NAME = "Intel"
INSTALL_FILE_NAME = "ClassroomDeviceAgent.exe"
INSTALL_PROMPT_TITLE = "Classroom Manager"
KNOWN_BROWSER_PROCESSES = {
    "brave.exe",
    "chrome.exe",
    "chromium.exe",
    "firefox.exe",
    "iexplore.exe",
    "msedge.exe",
    "opera.exe",
    "vivaldi.exe",
}
SITE_KEYWORD_STOP_WORDS = {
    "app",
    "co",
    "com",
    "de",
    "dev",
    "edu",
    "gov",
    "info",
    "io",
    "local",
    "localhost",
    "mil",
    "net",
    "online",
    "org",
    "schule",
    "school",
    "site",
    "uk",
    "us",
    "www",
}
BROWSER_URL_RESOLVER_TEMPLATE = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

function Test-UrlCandidate([string]$Text) {
    if (-not $Text) { return $false }
    $trimmed = $Text.Trim()
    if (-not $trimmed) { return $false }
    if ($trimmed -match '^(https?|file|about|chrome|edge|brave|opera|vivaldi):') { return $true }
    if ($trimmed -like 'localhost*') { return $true }
    if ($trimmed -match '^[^\s/]+\.[^\s]+') { return $true }
    return $false
}

$handle = [IntPtr]__HWND__
$root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if (-not $root) { return }

$editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
)
$edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
$candidates = New-Object System.Collections.Generic.List[object]

for ($i = 0; $i -lt $edits.Count; $i++) {
    $element = $edits.Item($i)
    $name = ''
    $automationId = ''
    $className = ''
    $value = ''

    try { $name = [string]$element.Current.Name } catch {}
    try { $automationId = [string]$element.Current.AutomationId } catch {}
    try { $className = [string]$element.Current.ClassName } catch {}

    try {
        $pattern = $null
        if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
            $value = [string]$pattern.Current.Value
        }
    } catch {}

    if (-not $value) {
        try {
            $legacy = $null
            if ($element.TryGetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern, [ref]$legacy)) {
                $value = [string]$legacy.Current.Value
            }
        } catch {}
    }

    if (-not (Test-UrlCandidate $value)) { continue }

    $meta = "$name $automationId $className".ToLowerInvariant()
    $score = 0
    if ($value -match '^(https?|file|about|chrome|edge|brave|opera|vivaldi):') {
        $score += 12
    } elseif ($value -like 'localhost*' -or $value -match '^[^\s/]+\.[^\s]+') {
        $score += 8
    }

    if ($meta -match 'address|location|search|url|omnibox|bar') {
        $score += 6
    }
    if ($automationId -match 'address|location|search|url|omnibox') {
        $score += 4
    }
    if ($className -match 'omnibox|address') {
        $score += 4
    }

    $candidates.Add([PSCustomObject]@{
        value = $value.Trim()
        score = $score
    }) | Out-Null
}

if ($candidates.Count -eq 0) { return }

$best = $candidates |
    Sort-Object -Property @{ Expression = 'score'; Descending = $true }, @{ Expression = { $_.value.Length }; Descending = $true } |
    Select-Object -First 1

if ($best) {
    $best | ConvertTo-Json -Compress
}
"""

AUDIO_ENDPOINT_VOLUME_HELPER = r"""
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
    int NotImpl1();
    [PreserveSig]
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
    [PreserveSig]
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr pNotify);
    int UnregisterControlChangeNotify(IntPtr pNotify);
    int GetChannelCount(out uint pnChannelCount);
    int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
    int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
    int GetMasterVolumeLevel(out float pfLevelDB);
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int SetChannelVolumeLevel(uint nChannel, float fLevelDB, Guid pguidEventContext);
    int SetChannelVolumeLevelScalar(uint nChannel, float fLevel, Guid pguidEventContext);
    int GetChannelVolumeLevel(uint nChannel, out float pfLevelDB);
    int GetChannelVolumeLevelScalar(uint nChannel, out float pfLevel);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, Guid pguidEventContext);
    int GetMute(out bool pbMute);
    int GetVolumeStepInfo(out uint pnStep, out uint pnStepCount);
    int VolumeStepUp(Guid pguidEventContext);
    int VolumeStepDown(Guid pguidEventContext);
    int QueryHardwareSupport(out uint pdwHardwareSupportMask);
    int GetVolumeRange(out float pflVolumeMindB, out float pflVolumeMaxdB, out float pflVolumeIncrementdB);
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject {
}

public static class AudioEndpointVolumeBridge {
    private const int CLSCTX_ALL = 23;
    private const int ERender = 0;
    private const int EMultimedia = 1;

    private static IAudioEndpointVolume GetEndpointVolume() {
        IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(ERender, EMultimedia, out device));
        Guid iid = typeof(IAudioEndpointVolume).GUID;
        object endpointVolume;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, CLSCTX_ALL, IntPtr.Zero, out endpointVolume));
        return (IAudioEndpointVolume)endpointVolume;
    }

    public static int GetVolume() {
        float level;
        Marshal.ThrowExceptionForHR(GetEndpointVolume().GetMasterVolumeLevelScalar(out level));
        return Math.Max(0, Math.Min(100, (int)Math.Round(level * 100)));
    }

    public static int SetVolume(int percent) {
        int clamped = Math.Max(0, Math.Min(100, percent));
        float scalar = clamped / 100f;
        Marshal.ThrowExceptionForHR(GetEndpointVolume().SetMasterVolumeLevelScalar(scalar, Guid.Empty));
        return GetVolume();
    }
}
"@ -Language CSharp
"""


teacher_session_active = False
attention_mode_active = False
screen_blackout_active = False
screen_share_request_pending = False
screen_share_declined = False
exam_mode_active = False
dashboard_connection_active = False
classroom_consent_pending = False
classroom_consent_accepted = False
classroom_consent_deadline: float | None = None
local_input_block_active = False
image_overlay_data: str | None = None
announcement_overlay_text: str | None = None
update_status = "Idle"
update_message = ""
_teacher_session_lock = threading.Lock()
_ui_event_queue: "queue.Queue[str]" = queue.Queue()
_classroom_consent_event = threading.Event()
_indicator_started = False
_cached_agent_id: str | None = None
_cached_browser_block_page_url: str | None = None
_browser_context_cache: dict[str, object] = {
    "key": "",
    "resolved_at": 0.0,
    "url": "",
    "domain": "",
}
_management_policy: dict[str, object] = {
    "allowedPrograms": [],
    "allowedSites": [],
    "websiteMode": "block",
    "inputLocked": False,
}
_last_enforcement_action: dict[str, object] = {
    "key": "",
    "at": 0.0,
}
_pending_website_violation: dict[str, object] = {
    "key": "",
    "started_at": 0.0,
}
_volume_state_cache: dict[str, object] = {
    "level": None,
    "checked_at": 0.0,
}
_system_input_block_enabled = False
_block_input_api_active = False
_agent_started_at = time.time()
_internal_input_passthrough_until = 0.0
_audio_control_lock = threading.RLock()

LAUNCHER_PROCESS_NAMES = {
    "cmd.exe",
    "conhost.exe",
    "powershell.exe",
    "pwsh.exe",
    "windowsterminal.exe",
}
PROTECTED_PROCESS_NAMES = {
    "ctfmon.exe",
    "dwm.exe",
    "explorer.exe",
    "lockapp.exe",
    "searchapp.exe",
    "searchhost.exe",
    "searchui.exe",
    "shellexperiencehost.exe",
    "slave.exe",
    "slaves.exe",
    "startmenuexperiencehost.exe",
    "systemsettings.exe",
    "taskmgr.exe",
    "textinputhost.exe",
}
_local_input_hook_thread: threading.Thread | None = None
_local_input_hook_ready = threading.Event()
_local_input_hook_failed = False
_keyboard_hook_handle = None
_mouse_hook_handle = None
_keyboard_hook_callback = None
_mouse_hook_callback = None


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT),
        ("dwTime", wintypes.DWORD),
    ]


class SYSTEM_POWER_STATUS(ctypes.Structure):
    _fields_ = [
        ("ACLineStatus", ctypes.c_byte),
        ("BatteryFlag", ctypes.c_byte),
        ("BatteryLifePercent", ctypes.c_byte),
        ("SystemStatusFlag", ctypes.c_byte),
        ("BatteryLifeTime", wintypes.DWORD),
        ("BatteryFullLifeTime", wintypes.DWORD),
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", wintypes.LONG),
        ("biHeight", wintypes.LONG),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", wintypes.LONG),
        ("biYPelsPerMeter", wintypes.LONG),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [
        ("bmiHeader", BITMAPINFOHEADER),
        ("bmiColors", wintypes.DWORD * 3),
    ]


ULONG_PTR = wintypes.WPARAM


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class INPUTUNION(ctypes.Union):
    _fields_ = [
        ("ki", KEYBDINPUT),
        ("mi", MOUSEINPUT),
        ("hi", HARDWAREINPUT),
    ]


class INPUT(ctypes.Structure):
    _fields_ = [
        ("type", wintypes.DWORD),
        ("union", INPUTUNION),
    ]


class POINT(ctypes.Structure):
    _fields_ = [
        ("x", wintypes.LONG),
        ("y", wintypes.LONG),
    ]


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class MSLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("pt", POINT),
        ("mouseData", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", wintypes.HWND),
        ("message", wintypes.UINT),
        ("wParam", wintypes.WPARAM),
        ("lParam", wintypes.LPARAM),
        ("time", wintypes.DWORD),
        ("pt", POINT),
        ("lPrivate", wintypes.DWORD),
    ]


SRCCOPY = 0x00CC0020
CAPTUREBLT = 0x40000000
HALFTONE = 4
BI_RGB = 0
DIB_RGB_COLORS = 0
SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79
INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_VIRTUALDESK = 0x4000
MOUSEEVENTF_ABSOLUTE = 0x8000
GA_ROOT = 2
WH_KEYBOARD_LL = 13
WH_MOUSE_LL = 14
HC_ACTION = 0
WM_CLOSE = 0x0010
LLKHF_INJECTED = 0x00000010
LLMHF_INJECTED = 0x00000001
MESSAGEBOX_OK = 0x0000
MESSAGEBOX_YES_NO = 0x0004
MESSAGEBOX_ICON_WARNING = 0x0030
MESSAGEBOX_ICON_QUESTION = 0x0020
MESSAGEBOX_ICON_INFORMATION = 0x0040
MESSAGEBOX_DEFAULT_BUTTON_2 = 0x0100
MESSAGEBOX_SYSTEM_MODAL = 0x1000
MESSAGEBOX_TOPMOST = 0x40000
MESSAGEBOX_FLAGS = MESSAGEBOX_SYSTEM_MODAL | MESSAGEBOX_TOPMOST
FILE_ATTRIBUTE_HIDDEN = 0x2
IDYES = 6

HOOKPROC = ctypes.WINFUNCTYPE(wintypes.LPARAM, ctypes.c_int, wintypes.WPARAM, wintypes.LPARAM)


MODIFIER_VK = {
    "shift": 0x10,
    "ctrl": 0x11,
    "alt": 0x12,
    "meta": 0x5B,
}


SPECIAL_KEY_VK = {
    "Enter": 0x0D,
    "Backspace": 0x08,
    "Tab": 0x09,
    "Escape": 0x1B,
    "Delete": 0x2E,
    "Insert": 0x2D,
    "Home": 0x24,
    "End": 0x23,
    "PageUp": 0x21,
    "PageDown": 0x22,
    "ArrowLeft": 0x25,
    "ArrowUp": 0x26,
    "ArrowRight": 0x27,
    "ArrowDown": 0x28,
    " ": 0x20,
    "Spacebar": 0x20,
}


for function_key in range(1, 13):
    SPECIAL_KEY_VK[f"F{function_key}"] = 0x6F + function_key


def ensure_autostart():
    if platform.system() != "Windows":
        return

    try:
        import winreg

        executable = sys.executable
        if not getattr(sys, "frozen", False):
            script = os.path.abspath(__file__)
            pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
            executable = pythonw if os.path.isfile(pythonw) else sys.executable
            value = f'"{executable}" "{script}"'
        else:
            value = f'"{executable}"'

        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            AUTOSTART_KEY,
            0,
            winreg.KEY_SET_VALUE,
        )
        winreg.SetValueEx(key, AUTOSTART_NAME, 0, winreg.REG_SZ, value)
        winreg.CloseKey(key)
    except Exception:
        pass


def show_install_message(text: str, flags: int) -> int:
    return int(ctypes.windll.user32.MessageBoxW(None, text, INSTALL_PROMPT_TITLE, flags | MESSAGEBOX_FLAGS))


def get_documents_dir() -> str:
    return os.path.join(os.path.expanduser("~"), "Documents")


def get_install_dir() -> str:
    return os.path.join(get_documents_dir(), INSTALL_DIR_NAME)


def get_install_path() -> str:
    return os.path.join(get_install_dir(), INSTALL_FILE_NAME)


def hide_path_in_windows(path: str):
    if platform.system() != "Windows":
        return

    normalized_path = os.path.abspath(path or "").strip()
    if not normalized_path or not os.path.exists(normalized_path):
        return

    try:
        current_attributes = ctypes.windll.kernel32.GetFileAttributesW(normalized_path)
        if current_attributes == -1:
            return
        ctypes.windll.kernel32.SetFileAttributesW(normalized_path, current_attributes | FILE_ATTRIBUTE_HIDDEN)
    except Exception:
        pass


def schedule_file_delete(path: str):
    normalized_path = os.path.abspath(path or "").strip()
    if not normalized_path:
        return

    command = f'ping 127.0.0.1 -n 3 >nul & del /f /q "{normalized_path.replace(chr(34), chr(34) * 2)}"'
    try:
        subprocess.Popen(
            [os.environ.get("ComSpec", "cmd.exe"), "/c", command],
            creationflags=CREATE_NO_WINDOW,
            close_fds=True,
        )
    except Exception:
        pass


def launch_installed_copy(target_path: str):
    subprocess.Popen(
        [target_path, *sys.argv[1:]],
        cwd=os.path.dirname(target_path) or None,
        close_fds=True,
    )


def ensure_installed_copy() -> bool:
    if platform.system() != "Windows" or not getattr(sys, "frozen", False):
        return True

    current_source_path = os.path.abspath(sys.executable or "")
    current_path = os.path.normcase(current_source_path)
    target_install_path = get_install_path()
    target_path = os.path.normcase(os.path.abspath(target_install_path))
    if not current_path or current_path == target_path:
        return True

    prompt = (
        "Do you want the Classroom Manager to be installed on your computer?\n\n"
        "After installation, the installed copy will start automatically."
    )
    if show_install_message(prompt, MESSAGEBOX_YES_NO | MESSAGEBOX_ICON_QUESTION | MESSAGEBOX_DEFAULT_BUTTON_2) != IDYES:
        return False

    try:
        os.makedirs(get_install_dir(), exist_ok=True)
        hide_path_in_windows(get_install_dir())
        shutil.copy2(sys.executable, target_install_path)

        launch_installed_copy(target_install_path)
        schedule_file_delete(current_source_path)
        show_install_message(
            "Classroom Manager was installed successfully on your Laptop\n\n"
            "The installed copy has now been started. If an older version was already there, it has been replaced automatically, and the original downloaded file will be removed.",
            MESSAGEBOX_OK | MESSAGEBOX_ICON_INFORMATION,
        )
        return False
    except Exception as exc:
        show_install_message(
            "The Classroom Manager could not be installed on your Laptop\n\n"
            f"Reason: {exc}",
            MESSAGEBOX_OK | MESSAGEBOX_ICON_WARNING,
        )
        return False


def wait_for_network(timeout: int = 30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if get_local_ip() != "127.0.0.1":
            return
        time.sleep(2)


def enable_dpi_awareness():
    if platform.system() != "Windows":
        return

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def get_explicit_master_url() -> str:
    if len(sys.argv) > 1 and sys.argv[1].strip():
        return normalize_master_url(sys.argv[1].strip())

    env_url = os.environ.get("CLASSROOM_MASTER_URL", "").strip()
    if env_url:
        return normalize_master_url(env_url)

    env_host = os.environ.get("CLASSROOM_MASTER_HOST", "").strip()
    if env_host:
        return f"ws://{env_host}:3000/agent"

    return ""


def normalize_master_url(value: str) -> str:
    if value.startswith("http://"):
        return "ws://" + value[len("http://"):].rstrip("/") + "/agent"
    if value.startswith("https://"):
        return "wss://" + value[len("https://"):].rstrip("/") + "/agent"
    if value.startswith("ws://") or value.startswith("wss://"):
        return value if value.rstrip("/").endswith("/agent") else value.rstrip("/") + "/agent"
    return value


def get_local_ip() -> str:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except Exception:
        return "127.0.0.1"


def get_discovery_targets() -> list[str]:
    targets = {"255.255.255.255"}
    local_ip = get_local_ip()
    octets = local_ip.split(".")
    if len(octets) == 4 and all(part.isdigit() for part in octets[:3]):
        targets.add(f"{octets[0]}.{octets[1]}.{octets[2]}.255")
    return list(targets)


def get_status_file_path() -> str:
    return os.path.join(get_documents_dir(), STATUS_FILE_NAME)


def get_agent_state_dir() -> str:
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        state_dir = os.path.join(local_app_data, AGENT_STATE_DIR_NAME)
    else:
        state_dir = os.path.join(os.path.expanduser("~"), f".{AGENT_STATE_DIR_NAME.lower()}")

    os.makedirs(state_dir, exist_ok=True)
    return state_dir


def get_cached_master_url_path() -> str:
    return os.path.join(get_agent_state_dir(), CACHED_MASTER_URL_FILE_NAME)


def read_cached_master_url() -> str:
    try:
        with open(get_cached_master_url_path(), "r", encoding="utf-8") as cached_url_file:
            return normalize_master_url(cached_url_file.read().strip())
    except Exception:
        return ""


def write_cached_master_url(master_url: str):
    normalized = normalize_master_url(master_url.strip())
    if not normalized:
        return

    try:
        with open(get_cached_master_url_path(), "w", encoding="utf-8") as cached_url_file:
            cached_url_file.write(normalized)
    except Exception:
        pass


def discover_master_url(timeout: float = DISCOVERY_TIMEOUT_SECONDS) -> str:
    request_payload = json.dumps({
        "type": "classroom_discover",
        "protocol": DISCOVERY_PROTOCOL,
        "agentVersion": AGENT_VERSION,
    }).encode("utf-8")

    deadline = time.time() + timeout
    per_attempt_timeout = max(0.35, timeout / max(DISCOVERY_ATTEMPTS, 1))

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.settimeout(per_attempt_timeout)
        sock.bind(("", 0))

        for _ in range(DISCOVERY_ATTEMPTS):
            for target in get_discovery_targets():
                try:
                    sock.sendto(request_payload, (target, DISCOVERY_PORT))
                except Exception:
                    continue

            while time.time() < deadline:
                remaining = deadline - time.time()
                if remaining <= 0:
                    break

                try:
                    sock.settimeout(min(per_attempt_timeout, remaining))
                    raw_response, remote = sock.recvfrom(4096)
                except socket.timeout:
                    break
                except Exception:
                    continue

                try:
                    response = json.loads(raw_response.decode("utf-8"))
                except Exception:
                    continue

                if response.get("type") != "classroom_master" or response.get("protocol") != DISCOVERY_PROTOCOL:
                    continue

                http_port = int(response.get("httpPort") or 3000)
                agent_path = str(response.get("agentPath") or "/agent")
                scheme = "ws"
                discovered = normalize_master_url(f"{scheme}://{remote[0]}:{http_port}{agent_path}")
                if discovered:
                    return discovered
    finally:
        sock.close()

    return ""


def resolve_master_url(explicit_master_url: str = "") -> tuple[str, str]:
    if explicit_master_url:
        return explicit_master_url, "configured"

    discovered = discover_master_url()
    if discovered:
        write_cached_master_url(discovered)
        return discovered, "discovered"

    cached = read_cached_master_url()
    if cached:
        return cached, "cached"

    return "", "discovering"


def get_agent_id() -> str:
    global _cached_agent_id
    if _cached_agent_id:
        return _cached_agent_id

    agent_id_path = os.path.join(get_agent_state_dir(), AGENT_ID_FILE_NAME)
    try:
        if os.path.isfile(agent_id_path):
            with open(agent_id_path, "r", encoding="utf-8") as agent_id_file:
                existing = agent_id_file.read().strip()
            if existing:
                _cached_agent_id = existing
                return existing
    except Exception:
        pass

    generated = str(uuid.uuid4())
    try:
        with open(agent_id_path, "w", encoding="utf-8") as agent_id_file:
            agent_id_file.write(generated)
    except Exception:
        pass

    _cached_agent_id = generated
    return generated


def write_agent_status(master_url: str, state: str, details: str = ""):
    try:
        lines = [
            f"state: {state}",
            f"dashboard_url: {master_url}",
            f"local_ip: {get_local_ip()}",
            f"time: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        ]
        if details:
            lines.append(f"details: {details}")
        if "127.0.0.1" in master_url or "localhost" in master_url:
            lines.append("hint: on student laptops, use the teacher computer LAN IP instead of localhost.")

        with open(get_status_file_path(), "w", encoding="utf-8") as status_file:
            status_file.write("\n".join(lines) + "\n")
    except Exception:
        pass


def is_browser_process(process_name: str) -> bool:
    return process_name.strip().lower() in KNOWN_BROWSER_PROCESSES


def get_powershell_executable() -> str:
    candidates = []
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    candidates.append(os.path.join(system_root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"))

    powershell_path = shutil.which("powershell.exe")
    if powershell_path:
        candidates.append(powershell_path)

    pwsh_path = shutil.which("pwsh.exe")
    if pwsh_path:
        candidates.append(pwsh_path)

    for candidate in candidates:
        if candidate and os.path.isfile(candidate):
            return candidate

    return "powershell.exe"


def run_powershell_script(script: str, timeout: float = 5.0) -> str:
    encoded_command = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    completed = subprocess.run(
        [get_powershell_executable(), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded_command],
        capture_output=True,
        text=True,
        timeout=timeout,
        creationflags=CREATE_NO_WINDOW,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout or "").strip().splitlines()
        raise RuntimeError(detail[-1] if detail else "PowerShell exited with an unknown error.")
    return (completed.stdout or "").strip()


def build_audio_volume_script(action_line: str) -> str:
    return f"{AUDIO_ENDPOINT_VOLUME_HELPER}\n{action_line}\n"


def normalize_volume_level(value: object) -> int | None:
    try:
        numeric = int(round(float(value)))
    except Exception:
        return None
    return max(0, min(100, numeric))


def cache_volume_level(value: object):
    with _teacher_session_lock:
        _volume_state_cache["level"] = normalize_volume_level(value)
        _volume_state_cache["checked_at"] = time.time()


def get_system_volume_level(force_refresh: bool = False) -> int | None:
    if platform.system() != "Windows":
        return None

    with _teacher_session_lock:
        cached_level = normalize_volume_level(_volume_state_cache.get("level"))
        checked_at = float(_volume_state_cache.get("checked_at") or 0.0)
    if not force_refresh and cached_level is not None and time.time() - checked_at < AUDIO_VOLUME_CACHE_SECONDS:
        return cached_level

    try:
        stdout = run_powershell_script(
            build_audio_volume_script("Write-Output ([AudioEndpointVolumeBridge]::GetVolume())"),
            timeout=6.0,
        )
        lines = [line.strip() for line in stdout.splitlines() if line.strip()]
        level = normalize_volume_level(lines[-1] if lines else None)
        cache_volume_level(level)
        return level
    except Exception:
        return cached_level


def set_system_volume_level(level: object) -> tuple[bool, str]:
    normalized_level = normalize_volume_level(level)
    if normalized_level is None:
        return False, "Choose a volume between 0 and 100."
    if platform.system() != "Windows":
        return False, "Volume changes are only supported on Windows."

    try:
        stdout = run_powershell_script(
            build_audio_volume_script(f"Write-Output ([AudioEndpointVolumeBridge]::SetVolume({normalized_level}))"),
            timeout=6.0,
        )
        lines = [line.strip() for line in stdout.splitlines() if line.strip()]
        applied_level = normalize_volume_level(lines[-1] if lines else normalized_level)
        cache_volume_level(applied_level)
        return True, f"Set volume to {applied_level if applied_level is not None else normalized_level}%."
    except Exception as exc:
        return False, f"Could not change the volume: {exc}"


def normalize_browser_url(value: str) -> str:
    candidate = value.strip()
    if not candidate:
        return ""

    candidate = candidate.replace("\u200e", "").replace("\u200f", "").strip()
    if candidate.startswith("view-source:"):
        candidate = candidate[len("view-source:"):]

    if "://" not in candidate and not candidate.startswith("about:") and not candidate.startswith("chrome:") and not candidate.startswith("edge:"):
        if candidate.startswith("localhost") or ("." in candidate.split("/", 1)[0] and " " not in candidate):
            candidate = f"https://{candidate}"

    try:
        parsed = urlparse(candidate)
    except Exception:
        return ""

    if parsed.scheme in {"http", "https", "file", "about", "chrome", "edge", "brave", "opera", "vivaldi"} and (
        parsed.netloc or parsed.scheme in {"about", "chrome", "edge", "brave", "opera", "vivaldi"}
    ):
        return candidate[:400]

    return ""


def extract_domain_from_url(value: str) -> str:
    normalized = normalize_browser_url(value)
    if not normalized:
        return ""

    try:
        parsed = urlparse(normalized)
    except Exception:
        return ""

    host = parsed.hostname or ""
    if host.startswith("www."):
        host = host[4:]
    return host[:120]


def extract_domain_from_text(value: str) -> str:
    if not value:
        return ""

    match = re.search(r"\b(?:https?://)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b", value, re.IGNORECASE)
    if not match:
        return ""

    return match.group(1).lower()[:120]


def resolve_browser_context(hwnd: int, process_name: str, title: str) -> dict[str, str]:
    if platform.system() != "Windows" or not hwnd or not is_browser_process(process_name):
        return {
            "browserUrl": "",
            "browserDomain": extract_domain_from_text(title),
        }

    cache_key = f"{int(hwnd)}|{process_name.lower()}|{title}"
    now = time.time()
    if _browser_context_cache["key"] == cache_key and now - float(_browser_context_cache["resolved_at"]) < 5:
        return {
            "browserUrl": str(_browser_context_cache["url"]),
            "browserDomain": str(_browser_context_cache["domain"]),
        }

    browser_url = ""
    try:
        script = BROWSER_URL_RESOLVER_TEMPLATE.replace("__HWND__", str(int(hwnd)))
        encoded_command = base64.b64encode(script.encode("utf-16le")).decode("ascii")
        completed = subprocess.run(
            [get_powershell_executable(), "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded_command],
            capture_output=True,
            text=True,
            timeout=1.5,
            creationflags=CREATE_NO_WINDOW,
        )
        stdout = (completed.stdout or "").strip()
        if stdout:
            payload = json.loads(stdout.splitlines()[-1])
            browser_url = normalize_browser_url(str(payload.get("value", "")))
    except Exception:
        browser_url = ""

    browser_domain = extract_domain_from_url(browser_url) or extract_domain_from_text(title)
    _browser_context_cache["key"] = cache_key
    _browser_context_cache["resolved_at"] = now
    _browser_context_cache["url"] = browser_url
    _browser_context_cache["domain"] = browser_domain

    return {
        "browserUrl": browser_url,
        "browserDomain": browser_domain,
    }


def get_foreground_window_info() -> dict[str, str]:
    if platform.system() != "Windows":
        return {
            "title": "Unavailable",
            "processName": "Unavailable",
            "processPath": "",
            "browserUrl": "",
            "browserDomain": "",
            "processId": 0,
            "windowHandle": 0,
        }

    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        hwnd = user32.GetForegroundWindow()
        if not hwnd:
            return {
                "title": "Desktop",
                "processName": "Desktop",
                "processPath": "",
                "browserUrl": "",
                "browserDomain": "",
                "processId": 0,
                "windowHandle": 0,
            }

        root_hwnd = user32.GetAncestor(hwnd, GA_ROOT)
        if root_hwnd:
            hwnd = root_hwnd

        length = user32.GetWindowTextLengthW(hwnd)
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, length + 1)
        title = buffer.value.strip()
        process_name = "Unavailable"
        process_path = ""

        process_id = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(process_id))
        if process_id.value:
            process_handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, process_id.value)
            if process_handle:
                try:
                    path_size = wintypes.DWORD(32768)
                    path_buffer = ctypes.create_unicode_buffer(path_size.value)
                    if kernel32.QueryFullProcessImageNameW(process_handle, 0, path_buffer, ctypes.byref(path_size)):
                        process_path = path_buffer.value.strip()
                        if process_path:
                            process_name = os.path.basename(process_path) or process_name
                finally:
                    kernel32.CloseHandle(process_handle)

        browser_context = resolve_browser_context(int(hwnd), process_name, title)

        return {
            "title": title[:120] if title else "Desktop",
            "processName": process_name,
            "processPath": process_path[:260],
            "browserUrl": browser_context["browserUrl"],
            "browserDomain": browser_context["browserDomain"],
            "processId": int(process_id.value),
            "windowHandle": int(hwnd),
        }
    except Exception:
        return {
            "title": "Unavailable",
            "processName": "Unavailable",
            "processPath": "",
            "browserUrl": "",
            "browserDomain": "",
            "processId": 0,
            "windowHandle": 0,
        }


def get_idle_seconds() -> float | None:
    if platform.system() != "Windows":
        return None

    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        info = LASTINPUTINFO()
        info.cbSize = ctypes.sizeof(LASTINPUTINFO)
        if not user32.GetLastInputInfo(ctypes.byref(info)):
            return None
        tick_count = kernel32.GetTickCount64()
        return max(0.0, (tick_count - info.dwTime) / 1000.0)
    except Exception:
        return None


def get_session_status() -> str:
    idle_seconds = get_idle_seconds()
    if idle_seconds is None:
        return "Unknown"
    if idle_seconds >= 300:
        return "Idle"
    return "Active"


def get_battery_status() -> dict:
    if platform.system() != "Windows":
        return {"present": False, "charging": False, "percent": None, "text": "Unavailable"}

    try:
        status = SYSTEM_POWER_STATUS()
        if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(status)):
            return {"present": False, "charging": False, "percent": None, "text": "Unavailable"}

        has_battery = status.BatteryFlag != 128
        percent = None if status.BatteryLifePercent == 255 else int(status.BatteryLifePercent)
        charging = status.ACLineStatus == 1

        if not has_battery:
            text = "AC power"
        elif percent is None:
            text = "Battery unavailable"
        else:
            suffix = "charging" if charging else "battery"
            text = f"{percent}% {suffix}"

        return {
            "present": has_battery,
            "charging": charging,
            "percent": percent,
            "text": text,
        }
    except Exception:
        return {"present": False, "charging": False, "percent": None, "text": "Unavailable"}


def get_teacher_session_state() -> str:
    with _teacher_session_lock:
        return "Connected" if teacher_session_active else "Standby"


def is_screen_share_active() -> bool:
    with _teacher_session_lock:
        return teacher_session_active


def get_screen_share_state() -> str:
    with _teacher_session_lock:
        if teacher_session_active:
            return "Active"
        if screen_share_request_pending:
            return "Requested"
        if screen_share_declined:
            return "Declined"
        return "Idle"


def get_attention_mode_state() -> str:
    with _teacher_session_lock:
        return "On" if attention_mode_active else "Off"


def get_exam_mode_state() -> str:
    with _teacher_session_lock:
        return "On" if exam_mode_active else "Off"


def get_screen_blackout_state() -> str:
    with _teacher_session_lock:
        return "On" if screen_blackout_active else "Off"


def get_input_lock_state() -> str:
    with _teacher_session_lock:
        return "On" if _system_input_block_enabled else "Off"


def get_image_display_state() -> str:
    with _teacher_session_lock:
        return "On" if image_overlay_data else "Off"


def get_announcement_display_state() -> str:
    with _teacher_session_lock:
        return "On" if announcement_overlay_text else "Off"


def get_audio_playback_state() -> str:
    if platform.system() != "Windows":
        return "Unavailable"

    with _audio_control_lock:
        mode = get_mci_status(CLASSROOM_AUDIO_ALIAS, "mode")
        if not mode:
            return "Idle"

        normalized_mode = mode.strip().lower()
        if normalized_mode == "playing":
            return "Playing"
        if normalized_mode == "paused":
            return "Paused"
        if normalized_mode == "stopped":
            stop_audio_playback()
            return "Idle"
        if normalized_mode == "not ready":
            return "Preparing"
        return normalized_mode.title()


def get_update_state() -> tuple[str, str]:
    with _teacher_session_lock:
        return update_status, update_message


def normalize_announcement_text(value: object) -> str:
    text = str(value or "").replace("\r\n", "\n").strip()
    return text[:MAX_ANNOUNCEMENT_TEXT_LENGTH]


def normalize_website_mode(value: object) -> str:
    return "warn" if str(value or "").strip().lower() == "warn" else "block"


def set_update_state(status: str, message: str = ""):
    with _teacher_session_lock:
        global update_status
        global update_message
        update_status = status
        update_message = message[:200]


def get_management_policy() -> dict[str, object]:
    with _teacher_session_lock:
        return {
            "allowedPrograms": list(_management_policy["allowedPrograms"]),
            "allowedSites": list(_management_policy["allowedSites"]),
            "websiteMode": normalize_website_mode(_management_policy.get("websiteMode")),
            "inputLocked": bool(_management_policy["inputLocked"]),
        }


def set_management_policy(
    allowed_programs: list[str],
    allowed_sites: list[str],
    website_mode: str,
    input_locked: bool,
):
    normalized_programs = list(allowed_programs)
    normalized_sites = list(allowed_sites)
    normalized_website_mode = normalize_website_mode(website_mode)
    normalized_input_locked = bool(input_locked)

    with _teacher_session_lock:
        global local_input_block_active
        policy_changed = (
            _management_policy["allowedPrograms"] != normalized_programs
            or _management_policy["allowedSites"] != normalized_sites
            or normalize_website_mode(_management_policy.get("websiteMode")) != normalized_website_mode
            or bool(_management_policy["inputLocked"]) != normalized_input_locked
        )
        _management_policy["allowedPrograms"] = normalized_programs
        _management_policy["allowedSites"] = normalized_sites
        _management_policy["websiteMode"] = normalized_website_mode
        _management_policy["inputLocked"] = normalized_input_locked
        local_input_block_active = normalized_input_locked
        _pending_website_violation["key"] = ""
        _pending_website_violation["started_at"] = 0.0
    if policy_changed:
        enqueue_ui_event("management_policy_changed")


def is_protected_process_name(process_name: str) -> bool:
    return str(process_name or "").strip().lower() in PROTECTED_PROCESS_NAMES


def is_current_agent_process(process_name: str, process_path: str = "") -> bool:
    normalized_name = str(process_name or "").strip().lower()
    if normalized_name in {"slave.exe", "slaves.exe"}:
        return True

    executable_path = os.path.normcase(os.path.abspath(sys.executable or ""))
    candidate_path = os.path.normcase(os.path.abspath(process_path or "")) if process_path else ""
    if executable_path and candidate_path and executable_path == candidate_path:
        return True

    return False


def should_skip_enforcement_for_foreground(foreground: dict[str, object]) -> bool:
    process_id = int(foreground.get("processId") or 0)
    process_name = str(foreground.get("processName") or "").strip().lower()
    process_path = str(foreground.get("processPath") or "").strip()
    executable_name = os.path.basename(sys.executable or "").strip().lower()
    parent_process_id = os.getppid()

    if process_id > 0 and process_id in {os.getpid(), parent_process_id}:
        return True

    if is_current_agent_process(process_name, process_path):
        return True

    if executable_name and process_name == executable_name:
        return True

    if is_protected_process_name(process_name):
        return True

    if process_name == "conhost.exe":
        return True

    if not getattr(sys, "frozen", False) and process_name in LAUNCHER_PROCESS_NAMES:
        return True

    if time.time() - _agent_started_at < ENFORCEMENT_LAUNCH_GRACE_SECONDS and process_name in LAUNCHER_PROCESS_NAMES:
        return True

    return False


def build_browser_block_page_url(reason: str = "") -> str:
    global _cached_browser_block_page_url

    if _cached_browser_block_page_url:
        return _cached_browser_block_page_url

    message = html.escape("This website is not in the allowed classroom list.")
    markup = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Classroom access limited</title>
<style>
body {{
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: "Segoe UI", sans-serif;
  background: linear-gradient(180deg, #fff2f2 0%, #ffe0e0 100%);
  color: #3b0b0f;
}}
.panel {{
  max-width: 720px;
  margin: 32px;
  padding: 36px 40px;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.92);
  border: 2px solid rgba(186, 26, 26, 0.2);
  box-shadow: 0 20px 60px rgba(128, 17, 17, 0.16);
}}
.eyebrow {{
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #a21d22;
}}
h1 {{
  margin: 0;
  font-size: 40px;
  line-height: 1;
}}
p {{
  margin: 18px 0 0;
  font-size: 18px;
  line-height: 1.6;
}}
</style>
</head>
<body>
  <main class="panel">
    <p class="eyebrow">Classroom Policy</p>
    <h1>Website blocked</h1>
    <p>{message}</p>
  </main>
</body>
</html>"""
    try:
        block_page_path = os.path.join(get_agent_state_dir(), "blocked-site.html")
        with open(block_page_path, "w", encoding="utf-8") as block_page_file:
            block_page_file.write(markup)
        _cached_browser_block_page_url = Path(block_page_path).resolve().as_uri()
        return _cached_browser_block_page_url
    except Exception:
        return "about:blank"


def collect_status() -> dict:
    foreground = get_foreground_window_info()
    current_update_status, current_update_message = get_update_state()

    return {
        "agentId": get_agent_id(),
        "agentVersion": AGENT_VERSION,
        "hostname": socket.gethostname(),
        "username": getpass.getuser(),
        "ip": get_local_ip(),
        "platform": platform.system(),
        "version": platform.version(),
        "appStatus": foreground["title"],
        "foregroundProcess": foreground["processName"],
        "foregroundPath": foreground["processPath"],
        "browserUrl": foreground["browserUrl"],
        "browserDomain": foreground["browserDomain"],
        "inputLocked": get_input_lock_state(),
        "sessionStatus": get_session_status(),
        "teacherSession": get_teacher_session_state(),
        "screenShareStatus": get_screen_share_state(),
        "attentionMode": get_attention_mode_state(),
        "screenBlackout": get_screen_blackout_state(),
        "imageDisplay": get_image_display_state(),
        "announcementDisplay": get_announcement_display_state(),
        "audioPlayback": get_audio_playback_state(),
        "volumeLevel": get_system_volume_level(),
        "updateStatus": current_update_status,
        "updateMessage": current_update_message,
        "battery": get_battery_status(),
    }


def capture_screen_frame(
    previous_crc: int | None = None,
    max_width: int = SCREEN_PREVIEW_MAX_WIDTH,
    max_height: int = SCREEN_PREVIEW_MAX_HEIGHT,
    force_send: bool = False,
) -> tuple[dict | None, int | None]:
    if platform.system() != "Windows":
        return None, previous_crc

    user32 = ctypes.windll.user32
    gdi32 = ctypes.windll.gdi32

    screen_dc = None
    memory_dc = None
    bitmap = None
    previous_bitmap = None

    try:
        source_x = user32.GetSystemMetrics(SM_XVIRTUALSCREEN)
        source_y = user32.GetSystemMetrics(SM_YVIRTUALSCREEN)
        source_width = user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)
        source_height = user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)

        if source_width <= 0 or source_height <= 0:
            source_x = 0
            source_y = 0
            source_width = user32.GetSystemMetrics(0)
            source_height = user32.GetSystemMetrics(1)

        if source_width <= 0 or source_height <= 0:
            return None, previous_crc

        scale = min(
            max_width / source_width,
            max_height / source_height,
            1.0,
        )
        target_width = max(1, int(source_width * scale))
        target_height = max(1, int(source_height * scale))

        screen_dc = user32.GetDC(0)
        if not screen_dc:
            return None, previous_crc

        memory_dc = gdi32.CreateCompatibleDC(screen_dc)
        if not memory_dc:
            return None, previous_crc

        bitmap = gdi32.CreateCompatibleBitmap(screen_dc, target_width, target_height)
        if not bitmap:
            return None, previous_crc

        previous_bitmap = gdi32.SelectObject(memory_dc, bitmap)
        gdi32.SetStretchBltMode(memory_dc, HALFTONE)

        copied = gdi32.StretchBlt(
            memory_dc,
            0,
            0,
            target_width,
            target_height,
            screen_dc,
            source_x,
            source_y,
            source_width,
            source_height,
            SRCCOPY | CAPTUREBLT,
        )
        if not copied:
            return None, previous_crc

        bitmap_info = BITMAPINFO()
        bitmap_info.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bitmap_info.bmiHeader.biWidth = target_width
        bitmap_info.bmiHeader.biHeight = -target_height
        bitmap_info.bmiHeader.biPlanes = 1
        bitmap_info.bmiHeader.biBitCount = 32
        bitmap_info.bmiHeader.biCompression = BI_RGB
        bitmap_info.bmiHeader.biSizeImage = target_width * target_height * 4

        pixel_buffer = ctypes.create_string_buffer(bitmap_info.bmiHeader.biSizeImage)
        scan_lines = gdi32.GetDIBits(
            memory_dc,
            bitmap,
            0,
            target_height,
            pixel_buffer,
            ctypes.byref(bitmap_info),
            DIB_RGB_COLORS,
        )
        if scan_lines != target_height:
            return None, previous_crc

        pixel_data = pixel_buffer.raw
        frame_crc = zlib.crc32(pixel_data)
        if not force_send and previous_crc is not None and frame_crc == previous_crc:
            return None, frame_crc

        bmp_header = struct.pack(
            "<2sIHHI",
            b"BM",
            14 + 40 + len(pixel_data),
            0,
            0,
            54,
        )
        dib_header = struct.pack(
            "<IiiHHIIiiII",
            40,
            target_width,
            -target_height,
            1,
            32,
            BI_RGB,
            len(pixel_data),
            2835,
            2835,
            0,
            0,
        )
        bmp_bytes = bmp_header + dib_header + pixel_data

        return {
            "mimeType": "image/bmp",
            "data": base64.b64encode(bmp_bytes).decode("ascii"),
            "width": target_width,
            "height": target_height,
            "sourceLeft": source_x,
            "sourceTop": source_y,
            "sourceWidth": source_width,
            "sourceHeight": source_height,
            "capturedAt": int(time.time() * 1000),
        }, frame_crc
    except Exception:
        return None, previous_crc
    finally:
        if memory_dc and previous_bitmap:
            gdi32.SelectObject(memory_dc, previous_bitmap)
        if bitmap:
            gdi32.DeleteObject(bitmap)
        if memory_dc:
            gdi32.DeleteDC(memory_dc)
        if screen_dc:
            user32.ReleaseDC(0, screen_dc)


def matches_rule_list(value: str, rules: list[str]) -> bool:
    haystack = str(value or "").lower()
    return any(rule.lower() in haystack for rule in rules)


def normalize_rule_list(value) -> list[str]:
    raw_items = value if isinstance(value, list) else []
    normalized: list[str] = []
    seen: set[str] = set()

    for item in raw_items:
        text = str(item or "").strip()[:120]
        lookup = text.lower()
        if not text or lookup in seen:
            continue
        seen.add(lookup)
        normalized.append(text)

    return normalized[:40]


def normalize_site_token(value: str) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""

    candidate = raw.removeprefix("view-source:")
    if "://" not in candidate and not candidate.startswith(("about:", "chrome:", "edge:", "brave:", "opera:", "vivaldi:")):
        if candidate.startswith("localhost") or ("." in candidate.split("/", 1)[0] and " " not in candidate):
            candidate = f"https://{candidate}"

    try:
        parsed = urlparse(candidate)
    except Exception:
        return ""

    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def extract_site_keywords(value: str) -> list[str]:
    normalized = normalize_site_token(value)
    if not normalized:
        return []

    return [
        part
        for part in normalized.split(".")
        if len(part) >= 3 and part not in SITE_KEYWORD_STOP_WORDS
    ]


def title_contains_site_keywords(title: str, keywords: list[str]) -> bool:
    title_text = str(title or "").lower()
    if not title_text or not keywords:
        return False

    for keyword in keywords:
        pattern = re.compile(rf"(^|[^a-z0-9]){re.escape(keyword)}([^a-z0-9]|$)", re.IGNORECASE)
        if not pattern.search(title_text):
            return False
    return True


def matches_site_rule(foreground: dict[str, object], rule: str) -> bool:
    raw_rule = str(rule or "").strip().lower()
    if not raw_rule:
        return False

    normalized_rule = normalize_site_token(raw_rule)
    url_candidates = [
        str(foreground.get("browserUrl") or "").lower(),
        str(foreground.get("browserDomain") or "").lower(),
    ]
    title_candidate = str(foreground.get("title") or "").lower()

    if any(raw_rule in candidate for candidate in url_candidates if candidate):
        return True
    if raw_rule and raw_rule in title_candidate:
        return True

    site_keywords = extract_site_keywords(raw_rule)
    if title_contains_site_keywords(title_candidate, site_keywords):
        return True

    if not normalized_rule:
        return False

    for candidate in url_candidates:
        candidate_host = normalize_site_token(candidate)
        if candidate_host == normalized_rule or candidate_host.endswith(f".{normalized_rule}"):
            return True
    return False


def matches_site_policy(foreground: dict[str, object], rules: list[str]) -> bool:
    return any(matches_site_rule(foreground, rule) for rule in rules)


def evaluate_foreground_activity(foreground: dict[str, object], allowed_programs: list[str], allowed_sites: list[str]) -> tuple[bool, str]:
    if not allowed_programs and not allowed_sites:
        return True, ""

    process_label = " ".join(
        str(value or "")
        for value in (
            foreground.get("processName"),
            foreground.get("processPath"),
            foreground.get("title"),
            foreground.get("browserDomain"),
            foreground.get("browserUrl"),
        )
    ).strip()
    browser_active = is_browser_process(str(foreground.get("processName") or ""))
    program_match = matches_rule_list(process_label, allowed_programs)
    site_match = matches_site_policy(foreground, allowed_sites)

    if browser_active and allowed_sites:
        if site_match:
            return True, ""
        observed = str(foreground.get("browserDomain") or foreground.get("browserUrl") or foreground.get("title") or "current browser tab")
        return False, f"{observed} is not in the allowed website list."

    if allowed_programs:
        if program_match:
            return True, ""
        observed = str(foreground.get("processName") or foreground.get("title") or "Current activity")
        return False, f"{observed} is outside the allowed program list."

    observed = str(foreground.get("browserDomain") or foreground.get("browserUrl") or foreground.get("title") or "current browser tab")
    return False, f"{observed} is not in the allowed website list."


def allow_internal_input(seconds: float = 0.8):
    global _internal_input_passthrough_until
    _internal_input_passthrough_until = max(_internal_input_passthrough_until, time.time() + max(0.1, seconds))


def _keyboard_hook_handler(n_code: int, w_param: int, l_param: int):
    if n_code == HC_ACTION and _system_input_block_enabled:
        if time.time() >= _internal_input_passthrough_until:
            return 1

    return ctypes.windll.user32.CallNextHookEx(None, n_code, w_param, l_param)


def _mouse_hook_handler(n_code: int, w_param: int, l_param: int):
    if n_code == HC_ACTION and _system_input_block_enabled:
        if time.time() >= _internal_input_passthrough_until:
            return 1

    return ctypes.windll.user32.CallNextHookEx(None, n_code, w_param, l_param)


def _local_input_hook_loop():
    global _local_input_hook_failed
    global _keyboard_hook_handle
    global _mouse_hook_handle
    global _keyboard_hook_callback
    global _mouse_hook_callback
    global _system_input_block_enabled

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32

    try:
        module_handle = kernel32.GetModuleHandleW(None)
        _keyboard_hook_callback = HOOKPROC(_keyboard_hook_handler)
        _mouse_hook_callback = HOOKPROC(_mouse_hook_handler)
        _keyboard_hook_handle = user32.SetWindowsHookExW(WH_KEYBOARD_LL, _keyboard_hook_callback, module_handle, 0)
        _mouse_hook_handle = user32.SetWindowsHookExW(WH_MOUSE_LL, _mouse_hook_callback, module_handle, 0)

        if not _keyboard_hook_handle or not _mouse_hook_handle:
            if _keyboard_hook_handle:
                user32.UnhookWindowsHookEx(_keyboard_hook_handle)
            if _mouse_hook_handle:
                user32.UnhookWindowsHookEx(_mouse_hook_handle)
            _keyboard_hook_handle = None
            _mouse_hook_handle = None
            _local_input_hook_failed = True
            return

        _local_input_hook_ready.set()
        message = MSG()
        while True:
            result = user32.GetMessageW(ctypes.byref(message), None, 0, 0)
            if result in (0, -1):
                break
            user32.TranslateMessage(ctypes.byref(message))
            user32.DispatchMessageW(ctypes.byref(message))
    except Exception:
        _local_input_hook_failed = True
    finally:
        _system_input_block_enabled = False
        try:
            if _keyboard_hook_handle:
                user32.UnhookWindowsHookEx(_keyboard_hook_handle)
        except Exception:
            pass
        try:
            if _mouse_hook_handle:
                user32.UnhookWindowsHookEx(_mouse_hook_handle)
        except Exception:
            pass
        _keyboard_hook_handle = None
        _mouse_hook_handle = None
        _local_input_hook_ready.set()


def ensure_local_input_hooks() -> bool:
    global _local_input_hook_thread

    if platform.system() != "Windows":
        return False

    if _local_input_hook_failed:
        return False

    if _local_input_hook_thread and _local_input_hook_thread.is_alive():
        if not _local_input_hook_ready.is_set():
            _local_input_hook_ready.wait(1.0)
        return bool(_keyboard_hook_handle and _mouse_hook_handle)

    _local_input_hook_ready.clear()
    _local_input_hook_thread = threading.Thread(
        target=_local_input_hook_loop,
        name="LocalInputHook",
        daemon=True,
    )
    _local_input_hook_thread.start()
    _local_input_hook_ready.wait(1.5)
    return bool(_keyboard_hook_handle and _mouse_hook_handle)


def set_system_input_block(active: bool) -> bool:
    global _system_input_block_enabled
    global _block_input_api_active

    if platform.system() != "Windows":
        _system_input_block_enabled = False
        _block_input_api_active = False
        return False

    if not active:
        if _block_input_api_active:
            try:
                ctypes.windll.user32.BlockInput(False)
            except Exception:
                pass
        _block_input_api_active = False
        _system_input_block_enabled = False
        return False

    if _system_input_block_enabled:
        return _system_input_block_enabled

    try:
        _block_input_api_active = bool(ctypes.windll.user32.BlockInput(True))
    except Exception:
        _block_input_api_active = False

    _system_input_block_enabled = True
    return True


def navigate_current_browser_to_block_page(reason: str = ""):
    allow_internal_input(1.5)
    perform_remote_key("l", {"ctrl": True})
    time.sleep(0.05)
    send_unicode_text(build_browser_block_page_url(reason))
    time.sleep(0.03)
    perform_remote_key("Enter")


def request_window_close(window_handle: int) -> bool:
    if platform.system() != "Windows" or window_handle <= 0:
        return False

    try:
        return bool(ctypes.windll.user32.PostMessageW(int(window_handle), WM_CLOSE, 0, 0))
    except Exception:
        return False


def terminate_process_by_id(process_id: int, process_name: str = "") -> bool:
    if platform.system() != "Windows" or process_id <= 0:
        return False

    if is_protected_process_name(process_name):
        return False

    try:
        completed = subprocess.run(
            ["taskkill", "/PID", str(process_id), "/F"],
            capture_output=True,
            text=True,
            timeout=3,
            creationflags=CREATE_NO_WINDOW,
        )
        return completed.returncode == 0
    except Exception:
        return False


def maybe_enforce_policy_once() -> bool:
    policy = get_management_policy()
    allowed_programs = list(policy["allowedPrograms"])
    allowed_sites = list(policy["allowedSites"])
    website_mode = normalize_website_mode(policy.get("websiteMode"))

    if not allowed_programs and not allowed_sites:
        return False

    foreground = get_foreground_window_info()
    if should_skip_enforcement_for_foreground(foreground):
        return False

    title_text = str(foreground.get("title") or "").lower()
    browser_url = str(foreground.get("browserUrl") or "").lower()
    if "classroom access limited" in title_text or browser_url.startswith("data:text/html"):
        _pending_website_violation["key"] = ""
        _pending_website_violation["started_at"] = 0.0
        return False

    allowed, reason = evaluate_foreground_activity(foreground, allowed_programs, allowed_sites)
    if allowed:
        _pending_website_violation["key"] = ""
        _pending_website_violation["started_at"] = 0.0
        return False

    violation_key = "|".join([
        str(foreground.get("processName") or ""),
        str(foreground.get("browserDomain") or foreground.get("browserUrl") or foreground.get("title") or ""),
        reason,
    ])
    now = time.time()
    if _last_enforcement_action["key"] == violation_key and now - float(_last_enforcement_action["at"]) < ENFORCEMENT_REPEAT_SECONDS:
        return False

    process_name = str(foreground.get("processName") or "")
    if is_browser_process(process_name) and allowed_sites:
        if website_mode == "block":
            if _pending_website_violation["key"] != violation_key:
                _pending_website_violation["key"] = violation_key
                _pending_website_violation["started_at"] = now
                set_update_state("Website warning", f"Blocking in {WEBSITE_BLOCK_DELAY_SECONDS}s: {reason[:150]}")
                enqueue_ui_event("policy_warning")
                return False

            if now - float(_pending_website_violation["started_at"]) < WEBSITE_BLOCK_DELAY_SECONDS:
                return False

            _pending_website_violation["key"] = ""
            _pending_website_violation["started_at"] = 0.0

        if website_mode == "block":
            navigate_current_browser_to_block_page(reason)
        else:
            set_update_state("Website warning", reason[:180])
            enqueue_ui_event("policy_warning")
            _last_enforcement_action["key"] = violation_key
            _last_enforcement_action["at"] = now
            return False
    else:
        _pending_website_violation["key"] = ""
        _pending_website_violation["started_at"] = 0.0
        window_handle = int(foreground.get("windowHandle") or 0)
        process_id = int(foreground.get("processId") or 0)
        if window_handle and not request_window_close(window_handle):
            terminate_process_by_id(process_id, process_name)
        elif not window_handle:
            terminate_process_by_id(process_id, process_name)

    _last_enforcement_action["key"] = violation_key
    _last_enforcement_action["at"] = now
    set_update_state("Blocked activity", reason[:180])
    enqueue_ui_event("policy_enforced")
    return True


def send_inputs(inputs: list[INPUT]) -> bool:
    if platform.system() != "Windows" or not inputs:
        return False

    array_type = INPUT * len(inputs)
    input_array = array_type(*inputs)
    sent = ctypes.windll.user32.SendInput(len(inputs), input_array, ctypes.sizeof(INPUT))
    return sent == len(inputs)


def build_key_input(vk: int = 0, scan: int = 0, flags: int = 0) -> INPUT:
    return INPUT(
        type=INPUT_KEYBOARD,
        union=INPUTUNION(
            ki=KEYBDINPUT(
                wVk=vk,
                wScan=scan,
                dwFlags=flags,
                time=0,
                dwExtraInfo=0,
            ),
        ),
    )


def build_mouse_input(dx: int = 0, dy: int = 0, mouse_data: int = 0, flags: int = 0) -> INPUT:
    return INPUT(
        type=INPUT_MOUSE,
        union=INPUTUNION(
            mi=MOUSEINPUT(
                dx=dx,
                dy=dy,
                mouseData=mouse_data,
                dwFlags=flags,
                time=0,
                dwExtraInfo=0,
            ),
        ),
    )


def get_virtual_screen_bounds() -> tuple[int, int, int, int]:
    user32 = ctypes.windll.user32
    left = int(user32.GetSystemMetrics(SM_XVIRTUALSCREEN))
    top = int(user32.GetSystemMetrics(SM_YVIRTUALSCREEN))
    width = int(user32.GetSystemMetrics(SM_CXVIRTUALSCREEN))
    height = int(user32.GetSystemMetrics(SM_CYVIRTUALSCREEN))
    return left, top, max(1, width), max(1, height)


def normalize_mouse_coordinate(value: int, origin: int, span: int) -> int:
    if span <= 1:
        return 0

    relative = min(max(int(value) - origin, 0), span - 1)
    return int(round((relative * 65535) / (span - 1)))


def send_unicode_text(text: str):
    if platform.system() != "Windows" or not text:
        return False

    text = text.replace("\r\n", "\n").replace("\n", "\r\n")
    for start in range(0, len(text), TEXT_INPUT_CHUNK_SIZE):
        chunk = text[start : start + TEXT_INPUT_CHUNK_SIZE]
        inputs: list[INPUT] = []
        for char in chunk:
            code_point = ord(char)
            inputs.append(build_key_input(scan=code_point, flags=KEYEVENTF_UNICODE))
            inputs.append(build_key_input(scan=code_point, flags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP))

        if not send_inputs(inputs):
            return False

        if start + TEXT_INPUT_CHUNK_SIZE < len(text):
            time.sleep(0.01)

    return True


def tap_virtual_key(vk: int):
    send_inputs([
        build_key_input(vk=vk),
        build_key_input(vk=vk, flags=KEYEVENTF_KEYUP),
    ])


def press_virtual_key(vk: int):
    send_inputs([build_key_input(vk=vk)])


def release_virtual_key(vk: int):
    send_inputs([build_key_input(vk=vk, flags=KEYEVENTF_KEYUP)])


def perform_remote_key(key: str, modifiers: dict | None = None):
    if platform.system() != "Windows" or not key:
        return

    modifiers = modifiers or {}
    user32 = ctypes.windll.user32

    if len(key) == 1 and not modifiers.get("ctrl") and not modifiers.get("alt") and not modifiers.get("meta"):
        send_unicode_text(key)
        return

    vk = SPECIAL_KEY_VK.get(key)
    extra_modifier_keys: list[str] = []

    if vk is None and len(key) == 1:
        vk_info = user32.VkKeyScanW(ord(key))
        if vk_info == -1:
            send_unicode_text(key)
            return
        vk = vk_info & 0xFF
        if vk_info & 0x0100:
            extra_modifier_keys.append("shift")
        if vk_info & 0x0200:
            extra_modifier_keys.append("ctrl")
        if vk_info & 0x0400:
            extra_modifier_keys.append("alt")

    if vk is None:
        return

    pressed_modifiers: list[int] = []
    for name, enabled in modifiers.items():
        modifier_vk = MODIFIER_VK.get(name)
        if enabled and modifier_vk:
            pressed_modifiers.append(modifier_vk)
            press_virtual_key(modifier_vk)

    extra_pressed: list[int] = []
    for name in extra_modifier_keys:
        modifier_vk = MODIFIER_VK.get(name)
        if modifier_vk and modifier_vk not in pressed_modifiers:
            extra_pressed.append(modifier_vk)
            press_virtual_key(modifier_vk)

    tap_virtual_key(vk)

    for modifier_vk in reversed(extra_pressed):
        release_virtual_key(modifier_vk)
    for modifier_vk in reversed(pressed_modifiers):
        release_virtual_key(modifier_vk)


def move_mouse_to(x: int, y: int):
    if platform.system() != "Windows":
        return

    left, top, width, height = get_virtual_screen_bounds()
    absolute_x = normalize_mouse_coordinate(x, left, width)
    absolute_y = normalize_mouse_coordinate(y, top, height)
    send_inputs([
        build_mouse_input(
            dx=absolute_x,
            dy=absolute_y,
            flags=MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
        ),
    ])


def click_mouse(button: str = "left", x: int | None = None, y: int | None = None):
    if platform.system() != "Windows":
        return

    inputs: list[INPUT] = []
    if x is not None and y is not None:
        left, top, width, height = get_virtual_screen_bounds()
        inputs.append(
            build_mouse_input(
                dx=normalize_mouse_coordinate(x, left, width),
                dy=normalize_mouse_coordinate(y, top, height),
                flags=MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
            ),
        )

    flags = {
        "left": (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        "right": (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle": (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    }.get(button, (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP))

    inputs.append(build_mouse_input(flags=flags[0]))
    inputs.append(build_mouse_input(flags=flags[1]))
    send_inputs(inputs)


def press_mouse_button(button: str = "left", x: int | None = None, y: int | None = None):
    if platform.system() != "Windows":
        return

    inputs: list[INPUT] = []
    if x is not None and y is not None:
        left, top, width, height = get_virtual_screen_bounds()
        inputs.append(
            build_mouse_input(
                dx=normalize_mouse_coordinate(x, left, width),
                dy=normalize_mouse_coordinate(y, top, height),
                flags=MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
            ),
        )

    down_flag = {
        "left": MOUSEEVENTF_LEFTDOWN,
        "right": MOUSEEVENTF_RIGHTDOWN,
        "middle": MOUSEEVENTF_MIDDLEDOWN,
    }.get(button, MOUSEEVENTF_LEFTDOWN)

    inputs.append(build_mouse_input(flags=down_flag))
    send_inputs(inputs)


def release_mouse_button(button: str = "left", x: int | None = None, y: int | None = None):
    if platform.system() != "Windows":
        return

    inputs: list[INPUT] = []
    if x is not None and y is not None:
        left, top, width, height = get_virtual_screen_bounds()
        inputs.append(
            build_mouse_input(
                dx=normalize_mouse_coordinate(x, left, width),
                dy=normalize_mouse_coordinate(y, top, height),
                flags=MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
            ),
        )

    up_flag = {
        "left": MOUSEEVENTF_LEFTUP,
        "right": MOUSEEVENTF_RIGHTUP,
        "middle": MOUSEEVENTF_MIDDLEUP,
    }.get(button, MOUSEEVENTF_LEFTUP)

    inputs.append(build_mouse_input(flags=up_flag))
    send_inputs(inputs)


def open_website(url: str) -> tuple[bool, str]:
    if not url:
        return False, "No website was provided."

    normalized_url = url.strip()
    if not normalized_url.startswith(("http://", "https://")):
        normalized_url = f"https://{normalized_url}"

    try:
        if platform.system() == "Windows":
            os.startfile(normalized_url)
        else:
            return False, "Opening websites is only supported on Windows in this agent."
        return True, f"Opened {normalized_url}."
    except Exception as exc:
        return False, f"Could not open {normalized_url}: {exc}"


def launch_program(command: str) -> tuple[bool, str]:
    if not command or not command.strip():
        return False, "No program command was provided."

    try:
        subprocess.Popen(
            command.strip(),
            shell=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return True, f"Launched {command.strip()}."
    except Exception as exc:
        return False, f"Could not launch {command.strip()}: {exc}"


def send_mci_command(command: str) -> tuple[bool, str]:
    if platform.system() != "Windows":
        return False, "Audio playback is only supported on Windows."

    response = ctypes.create_unicode_buffer(260)
    error_code = ctypes.windll.winmm.mciSendStringW(command, response, len(response), 0)
    if error_code != 0:
        error_text = ctypes.create_unicode_buffer(260)
        ctypes.windll.winmm.mciGetErrorStringW(error_code, error_text, len(error_text))
        detail = error_text.value.strip() or f"MCI error {error_code}"
        return False, detail
    return True, response.value.strip()


def get_mci_status(alias: str, item: str) -> str:
    success, response = send_mci_command(f"status {alias} {item}")
    return response if success else ""


def stop_audio_playback() -> tuple[bool, str]:
    if platform.system() != "Windows":
        return False, "Audio playback is only supported on Windows."

    with _audio_control_lock:
        mode = get_mci_status(CLASSROOM_AUDIO_ALIAS, "mode")
        send_mci_command(f"stop {CLASSROOM_AUDIO_ALIAS}")
        send_mci_command(f"close {CLASSROOM_AUDIO_ALIAS}")

    if not mode:
        return True, "Audio was already idle."
    return True, "Stopped classroom audio."


def get_audio_payload_path() -> str:
    audio_dir = os.path.join(get_agent_state_dir(), "audio")
    os.makedirs(audio_dir, exist_ok=True)
    return os.path.join(audio_dir, "teacher-audio.mp3")


def play_audio_file(filename: str, payload: str) -> tuple[bool, str]:
    if platform.system() != "Windows":
        return False, "Audio playback is only supported on Windows."
    if not filename or not filename.lower().endswith(".mp3"):
        return False, "Only MP3 files are supported for classroom audio."

    try:
        raw_bytes = base64.b64decode(payload, validate=True)
    except Exception:
        return False, "The uploaded MP3 file could not be decoded."

    if not raw_bytes:
        return False, "The uploaded MP3 file was empty."
    if len(raw_bytes) > MAX_UPDATE_SIZE_BYTES:
        return False, "The uploaded MP3 file is too large."

    audio_path = get_audio_payload_path()
    with _audio_control_lock:
        send_mci_command(f"stop {CLASSROOM_AUDIO_ALIAS}")
        send_mci_command(f"close {CLASSROOM_AUDIO_ALIAS}")

        try:
            with open(audio_path, "wb") as audio_file:
                audio_file.write(raw_bytes)
        except Exception as exc:
            return False, f"Could not save the MP3 file: {exc}"

        success, detail = send_mci_command(f'open "{audio_path}" type mpegvideo alias {CLASSROOM_AUDIO_ALIAS}')
        if not success:
            return False, f"Could not open the MP3 file: {detail}"

        success, detail = send_mci_command(f"play {CLASSROOM_AUDIO_ALIAS}")
        if not success:
            send_mci_command(f"close {CLASSROOM_AUDIO_ALIAS}")
            return False, f"Could not start the MP3 file: {detail}"

    return True, f"Playing {os.path.basename(filename)}."


def lock_workstation() -> tuple[bool, str]:
    if platform.system() != "Windows":
        return False, "Locking the PC is only supported on Windows."

    try:
        if not ctypes.windll.user32.LockWorkStation():
            raise ctypes.WinError()
        return True, "Locked the PC."
    except Exception as exc:
        return False, f"Could not lock the PC: {exc}"


def schedule_system_power_action(arguments: list[str], success_message: str) -> tuple[bool, str]:
    if platform.system() != "Windows":
        return False, "Power actions are only supported on Windows."

    try:
        subprocess.Popen(
            ["shutdown.exe", *arguments],
            creationflags=CREATE_NO_WINDOW,
        )
        return True, success_message
    except Exception as exc:
        return False, f"Could not schedule the power action: {exc}"


def restart_computer() -> tuple[bool, str]:
    return schedule_system_power_action(
        [
            "/r",
            "/t",
            str(POWER_ACTION_DELAY_SECONDS),
            "/f",
            "/c",
            "Restart requested by the classroom dashboard.",
        ],
        f"Restart scheduled in {POWER_ACTION_DELAY_SECONDS} seconds.",
    )


def shutdown_computer() -> tuple[bool, str]:
    return schedule_system_power_action(
        [
            "/s",
            "/t",
            str(POWER_ACTION_DELAY_SECONDS),
            "/f",
            "/c",
            "Shutdown requested by the classroom dashboard.",
        ],
        f"Shutdown scheduled in {POWER_ACTION_DELAY_SECONDS} seconds.",
    )


def shutdown_for_classroom_consent() -> tuple[bool, str]:
    return schedule_system_power_action(
        [
            "/s",
            "/t",
            str(POWER_ACTION_DELAY_SECONDS),
            "/f",
            "/c",
            "Shutdown requested because classroom monitoring consent was not accepted.",
        ],
        f"Shutdown scheduled in {POWER_ACTION_DELAY_SECONDS} seconds.",
    )


def quote_cmd(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def build_restart_command() -> str:
    if getattr(sys, "frozen", False):
        return quote_cmd(sys.executable)

    script_path = os.path.abspath(__file__)
    pythonw = os.path.join(os.path.dirname(sys.executable), "pythonw.exe")
    runner = pythonw if os.path.isfile(pythonw) else sys.executable
    parts = [quote_cmd(runner), quote_cmd(script_path)]
    parts.extend(quote_cmd(argument) for argument in sys.argv[1:])
    return " ".join(parts)


def schedule_agent_update(filename: str, payload: str) -> tuple[bool, str]:
    if platform.system() != "Windows":
        return False, "Agent updates are only supported on Windows."

    try:
        raw_bytes = base64.b64decode(payload, validate=True)
    except Exception:
        return False, "The uploaded update file could not be decoded."

    if not raw_bytes:
        return False, "The uploaded update file was empty."
    if len(raw_bytes) > MAX_UPDATE_SIZE_BYTES:
        return False, "The uploaded update file is too large."

    target_path = sys.executable if getattr(sys, "frozen", False) else os.path.abspath(__file__)
    expected_extension = ".exe" if getattr(sys, "frozen", False) else ".py"
    extension = os.path.splitext(filename or "")[1].lower() or expected_extension
    if extension != expected_extension:
        return False, f"This agent expects a {expected_extension} update file."

    updates_dir = os.path.join(get_agent_state_dir(), "updates")
    os.makedirs(updates_dir, exist_ok=True)

    staged_name = f"pending-update{expected_extension}"
    staged_path = os.path.join(updates_dir, staged_name)
    updater_path = os.path.join(updates_dir, "apply-update.cmd")

    try:
        with open(staged_path, "wb") as staged_file:
            staged_file.write(raw_bytes)
    except Exception as exc:
        return False, f"Could not save the update file: {exc}"

    updater_script = "\r\n".join(
        [
            "@echo off",
            "setlocal",
            "timeout /t 2 /nobreak >nul",
            "for /l %%I in (1,1,20) do (",
            f'  >nul 2>nul copy /b /y {quote_cmd(staged_path)} {quote_cmd(target_path)} && goto copied',
            "  timeout /t 1 /nobreak >nul",
            ")",
            "exit /b 1",
            ":copied",
            f"start \"\" {build_restart_command()}",
            f"del /f /q {quote_cmd(staged_path)} >nul 2>nul",
            "(goto) 2>nul & del \"%~f0\"",
        ]
    )

    try:
        with open(updater_path, "w", encoding="utf-8", newline="\r\n") as updater_file:
            updater_file.write(updater_script + "\r\n")
    except Exception as exc:
        return False, f"Could not prepare the updater script: {exc}"

    try:
        subprocess.Popen(
            ["cmd.exe", "/c", updater_path],
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception as exc:
        return False, f"Could not start the updater: {exc}"

    return True, f"Installing {filename or os.path.basename(target_path)}."


def set_image_overlay(data: str | None):
    with _teacher_session_lock:
        global image_overlay_data
        image_overlay_data = data or None


def set_announcement_overlay(text: str | None):
    with _teacher_session_lock:
        global announcement_overlay_text
        announcement_overlay_text = normalize_announcement_text(text) or None


def load_overlay_photo_image(tk_module, data: str):
    last_error = None
    attempts = (
        lambda: tk_module.PhotoImage(data=data, format="png"),
        lambda: tk_module.PhotoImage(data=base64.b64decode(data), format="png"),
        lambda: tk_module.PhotoImage(data=data),
    )

    for attempt in attempts:
        try:
            return attempt()
        except Exception as exc:
            last_error = exc

    if last_error is not None:
        raise last_error
    raise ValueError("Could not decode overlay image data.")


def ensure_indicator():
    global _indicator_started
    if _indicator_started:
        return

    _indicator_started = True
    indicator_loop()


def indicator_loop():
    try:
        import tkinter as tk
    except Exception:
        return

    root = tk.Tk()
    root.withdraw()
    root.configure(bg="#000000")

    banner = tk.Toplevel(root)
    banner.withdraw()
    banner.overrideredirect(True)
    banner.attributes("-topmost", True)
    banner.configure(bg="#9f1a1a")
    banner.attributes("-alpha", 0.94)

    frame = tk.Frame(banner, bg="#9f1a1a", bd=0, highlightthickness=0)
    frame.pack(fill="both", expand=True)

    dot = tk.Canvas(frame, width=12, height=12, bg="#9f1a1a", bd=0, highlightthickness=0)
    dot.pack(side="left", padx=(10, 8), pady=9)

    label = tk.Label(
        frame,
        text="Being controlled by teacher",
        fg="#fff4f4",
        bg="#9f1a1a",
        font=("Segoe UI", 9, "bold"),
    )
    label.pack(side="left", padx=(0, 12), pady=8)

    classroom_consent_prompt = tk.Toplevel(root)
    classroom_consent_prompt.withdraw()
    classroom_consent_prompt.overrideredirect(True)
    classroom_consent_prompt.attributes("-topmost", True)
    classroom_consent_prompt.configure(bg="#16090a")
    classroom_consent_prompt.protocol("WM_DELETE_WINDOW", lambda: decline_classroom_consent())
    classroom_consent_prompt.bind("<Alt-F4>", lambda _event: (decline_classroom_consent(), "break")[1])
    classroom_consent_prompt.bind("<Escape>", lambda _event: (decline_classroom_consent(), "break")[1])

    classroom_consent_frame = tk.Frame(
        classroom_consent_prompt,
        bg="#f8f1e8",
        padx=42,
        pady=40,
        bd=0,
        highlightthickness=0,
    )
    classroom_consent_frame.place(relx=0.5, rely=0.5, anchor="center")

    classroom_consent_title = tk.Label(
        classroom_consent_frame,
        text="Use of this laptop in class requires consent",
        fg="#6a180e",
        bg="#f8f1e8",
        font=("Segoe UI", 24, "bold"),
        justify="center",
    )
    classroom_consent_title.pack(anchor="center")

    classroom_consent_body = tk.Label(
        classroom_consent_frame,
        text=(
            "If you want to use your laptop in class, you must agree that it may be "
            "subject to monitoring while class is in session."
        ),
        justify="center",
        wraplength=900,
        fg="#4a322a",
        bg="#f8f1e8",
        font=("Segoe UI", 18),
    )
    classroom_consent_body.pack(anchor="center", pady=(18, 20))

    classroom_consent_note = tk.Label(
        classroom_consent_frame,
        text="If you do not accept, this PC will shut down automatically.",
        justify="center",
        wraplength=900,
        fg="#7b5a43",
        bg="#f8f1e8",
        font=("Segoe UI", 14),
    )
    classroom_consent_note.pack(anchor="center", pady=(0, 14))

    classroom_consent_countdown = tk.Label(
        classroom_consent_frame,
        text="Shutdown in 30 seconds",
        justify="center",
        fg="#9f1a1a",
        bg="#f8f1e8",
        font=("Segoe UI", 22, "bold"),
    )
    classroom_consent_countdown.pack(anchor="center", pady=(0, 24))

    classroom_consent_actions = tk.Frame(classroom_consent_frame, bg="#f8f1e8")
    classroom_consent_actions.pack(anchor="center")

    classroom_shutdown_button = tk.Button(
        classroom_consent_actions,
        text="Shutdown",
        command=decline_classroom_consent,
        bg="#ead8cc",
        fg="#7a1e14",
        activebackground="#dfc8ba",
        activeforeground="#7a1e14",
        relief="flat",
        padx=28,
        pady=14,
        font=("Segoe UI", 14, "bold"),
    )
    classroom_shutdown_button.pack(side="left", padx=(0, 12))

    classroom_agree_button = tk.Button(
        classroom_consent_actions,
        text="Agree",
        command=accept_classroom_consent,
        bg="#9f1a1a",
        fg="#fff8f6",
        activebackground="#7f1515",
        activeforeground="#fff8f6",
        relief="flat",
        padx=28,
        pady=14,
        font=("Segoe UI", 14, "bold"),
    )
    classroom_agree_button.pack(side="left")

    consent_prompt = tk.Toplevel(root)
    consent_prompt.withdraw()
    consent_prompt.attributes("-topmost", True)
    consent_prompt.resizable(False, False)
    consent_prompt.title("Teacher screen-share request")
    consent_prompt.configure(bg="#fff4ef")
    consent_prompt.protocol("WM_DELETE_WINDOW", lambda: decline_screen_share())

    consent_frame = tk.Frame(consent_prompt, bg="#fff4ef", padx=18, pady=18)
    consent_frame.pack(fill="both", expand=True)

    consent_title = tk.Label(
        consent_frame,
        text="Teacher is requesting screen share",
        fg="#6f0f0f",
        bg="#fff4ef",
        font=("Segoe UI", 12, "bold"),
    )
    consent_title.pack(anchor="w")

    consent_body = tk.Label(
        consent_frame,
        text=(
            "Approve only if you are expecting classroom help. "
            "If you approve, a visible top-right notice will stay on screen."
        ),
        justify="left",
        wraplength=360,
        fg="#442a2a",
        bg="#fff4ef",
        font=("Segoe UI", 10),
    )
    consent_body.pack(anchor="w", pady=(10, 16))

    consent_actions = tk.Frame(consent_frame, bg="#fff4ef")
    consent_actions.pack(fill="x")

    deny_button = tk.Button(
        consent_actions,
        text="Deny",
        command=decline_screen_share,
        bg="#f3ddd8",
        fg="#7c1717",
        activebackground="#edd1cb",
        activeforeground="#7c1717",
        relief="flat",
        padx=18,
        pady=9,
    )
    deny_button.pack(side="right")

    approve_button = tk.Button(
        consent_actions,
        text="Approve",
        command=approve_screen_share,
        bg="#b31313",
        fg="#fff7f5",
        activebackground="#8e0f0f",
        activeforeground="#fff7f5",
        relief="flat",
        padx=18,
        pady=9,
    )
    approve_button.pack(side="right", padx=(0, 10))

    blackout = tk.Toplevel(root)
    blackout.withdraw()
    blackout.overrideredirect(True)
    blackout.attributes("-topmost", True)
    blackout.configure(bg="#000000", cursor="none")
    blackout.bind("<Alt-F4>", lambda _event: "break")
    blackout.bind("<Escape>", lambda _event: "break")
    blackout.bind("<Button>", lambda _event: "break")
    blackout.bind("<Key>", lambda _event: "break")

    blackout_message = tk.Label(
        blackout,
        text="Screen temporarily disabled by teacher",
        fg="#ffffff",
        bg="#000000",
        font=("Segoe UI", 28, "bold"),
    )
    blackout_message.place(relx=0.5, rely=0.48, anchor="center")

    blackout_note = tk.Label(
        blackout,
        text="Pass auf!",
        fg="#d8d8d8",
        bg="#000000",
        font=("Segoe UI", 14),
    )
    blackout_note.place(relx=0.5, rely=0.56, anchor="center")

    input_lock = tk.Toplevel(root)
    input_lock.withdraw()
    input_lock.overrideredirect(True)
    input_lock.attributes("-topmost", True)
    try:
        input_lock.attributes("-alpha", 0.94)
    except Exception:
        pass
    input_lock.configure(bg="#16090a", cursor="none")

    def block_overlay_event(_event=None):
        return "break"

    for sequence in (
        "<Alt-F4>",
        "<Escape>",
        "<Button>",
        "<ButtonPress>",
        "<ButtonRelease>",
        "<B1-Motion>",
        "<B2-Motion>",
        "<B3-Motion>",
        "<Motion>",
        "<MouseWheel>",
        "<Key>",
        "<KeyPress>",
        "<KeyRelease>",
    ):
        input_lock.bind(sequence, block_overlay_event)

    input_lock_message = tk.Label(
        input_lock,
        text="Keyboard and mouse locked by teacher",
        fg="#fff6f4",
        bg="#16090a",
        font=("Segoe UI", 28, "bold"),
    )
    input_lock_message.place(relx=0.5, rely=0.48, anchor="center")

    input_lock_note = tk.Label(
        input_lock,
        text="This device will unlock when the teacher clears the input lock.",
        fg="#f2c6c3",
        bg="#16090a",
        font=("Segoe UI", 14),
    )
    input_lock_note.place(relx=0.5, rely=0.56, anchor="center")

    image_overlay = tk.Toplevel(root)
    image_overlay.withdraw()
    image_overlay.overrideredirect(True)
    image_overlay.attributes("-topmost", True)
    image_overlay.configure(bg="#000000", cursor="none")
    image_overlay.bind("<Alt-F4>", lambda _event: "break")
    image_overlay.bind("<Escape>", lambda _event: "break")
    image_overlay.bind("<Button>", lambda _event: "break")
    image_overlay.bind("<Key>", lambda _event: "break")

    image_frame = tk.Frame(image_overlay, bg="#000000")
    image_frame.pack(fill="both", expand=True)

    image_label = tk.Label(
        image_frame,
        bg="#000000",
        fg="#ffffff",
        compound="center",
        text="Preparing image...",
        font=("Segoe UI", 18, "bold"),
    )
    image_label.place(relx=0.5, rely=0.5, anchor="center")

    image_note = tk.Label(
        image_overlay,
        text="Image sent by teacher",
        fg="#d8d8d8",
        bg="#000000",
        font=("Segoe UI", 12),
    )
    image_note.place(relx=0.5, rely=0.93, anchor="center")

    announcement_overlay = tk.Toplevel(root)
    announcement_overlay.withdraw()
    announcement_overlay.overrideredirect(True)
    announcement_overlay.attributes("-topmost", True)
    try:
        announcement_overlay.attributes("-alpha", 0.96)
    except Exception:
        pass
    announcement_overlay.configure(bg="#16110d")
    announcement_overlay.bind("<Alt-F4>", lambda _event: "break")
    announcement_overlay.bind("<Escape>", lambda _event: "break")
    announcement_overlay.bind("<Button>", lambda _event: "break")
    announcement_overlay.bind("<Key>", lambda _event: "break")

    announcement_frame = tk.Frame(announcement_overlay, bg="#16110d", padx=80, pady=70)
    announcement_frame.pack(fill="both", expand=True)

    announcement_title = tk.Label(
        announcement_frame,
        text="Teacher announcement",
        fg="#f8d6c0",
        bg="#16110d",
        font=("Segoe UI", 18, "bold"),
    )
    announcement_title.pack(anchor="center", pady=(10, 26))

    announcement_message = tk.Label(
        announcement_frame,
        text="",
        justify="center",
        wraplength=960,
        fg="#fff9f2",
        bg="#16110d",
        font=("Segoe UI", 30, "bold"),
    )
    announcement_message.pack(expand=True)

    announcement_note = tk.Label(
        announcement_frame,
        text="This message stays visible until the teacher clears it.",
        fg="#d6c7bc",
        bg="#16110d",
        font=("Segoe UI", 13),
    )
    announcement_note.pack(anchor="center", pady=(22, 10))

    image_state = {
        "raw": None,
        "photo_source": None,
        "photo_display": None,
        "screen_size": None,
    }

    def place_banner():
        banner.update_idletasks()
        x = max(12, banner.winfo_screenwidth() - banner.winfo_width() - 18)
        y = 18
        banner.geometry(f"+{x}+{y}")

    def place_classroom_consent_prompt():
        left, top, width, height = get_virtual_screen_bounds()
        classroom_consent_prompt.geometry(f"{width}x{height}+{left}+{top}")
        classroom_consent_prompt.lift()
        try:
            classroom_consent_prompt.grab_set()
            classroom_consent_prompt.focus_force()
        except Exception:
            pass

    def place_consent_prompt():
        consent_prompt.update_idletasks()
        screen_width = consent_prompt.winfo_screenwidth()
        screen_height = consent_prompt.winfo_screenheight()
        width = consent_prompt.winfo_width()
        height = consent_prompt.winfo_height()
        x = max(24, (screen_width - width) // 2)
        y = max(24, (screen_height - height) // 3)
        consent_prompt.geometry(f"+{x}+{y}")

    def place_blackout():
        width = blackout.winfo_screenwidth()
        height = blackout.winfo_screenheight()
        blackout.geometry(f"{width}x{height}+0+0")
        blackout.lift()
        try:
            blackout.grab_set()
            blackout.focus_force()
        except Exception:
            pass

    def place_input_lock():
        left, top, width, height = get_virtual_screen_bounds()
        input_lock.geometry(f"{width}x{height}+{left}+{top}")
        input_lock.lift()
        try:
            input_lock.grab_set()
            input_lock.focus_force()
        except Exception:
            pass

    def place_image_overlay():
        width = image_overlay.winfo_screenwidth()
        height = image_overlay.winfo_screenheight()
        image_overlay.geometry(f"{width}x{height}+0+0")
        image_overlay.lift()
        try:
            image_overlay.grab_set()
            image_overlay.focus_force()
        except Exception:
            pass

    def place_announcement_overlay():
        width = announcement_overlay.winfo_screenwidth()
        height = announcement_overlay.winfo_screenheight()
        announcement_overlay.geometry(f"{width}x{height}+0+0")
        announcement_message.configure(wraplength=max(360, width - 180))
        announcement_overlay.lift()
        try:
            announcement_overlay.grab_set()
            announcement_overlay.focus_force()
        except Exception:
            pass

    def update_image_overlay(data: str | None):
        if not data:
            image_state["raw"] = None
            image_state["photo_source"] = None
            image_state["photo_display"] = None
            image_state["screen_size"] = None
            image_label.configure(image="", text="Preparing image...")
            try:
                image_overlay.grab_release()
            except Exception:
                pass
            image_overlay.withdraw()
            return

        screen_size = (image_overlay.winfo_screenwidth(), image_overlay.winfo_screenheight())
        if data != image_state["raw"] or screen_size != image_state["screen_size"]:
            try:
                photo = load_overlay_photo_image(tk, data)
                max_width = max(1, image_overlay.winfo_screenwidth() - 80)
                max_height = max(1, image_overlay.winfo_screenheight() - 120)
                scale = max(1, math.ceil(max(photo.width() / max_width, photo.height() / max_height)))
                scaled_photo = photo if scale == 1 else photo.subsample(scale, scale)
                image_state["raw"] = data
                image_state["photo_source"] = photo
                image_state["photo_display"] = scaled_photo
                image_state["screen_size"] = screen_size
                image_label.configure(image=scaled_photo, text="")
            except Exception:
                image_state["raw"] = data
                image_state["photo_source"] = None
                image_state["photo_display"] = None
                image_state["screen_size"] = screen_size
                image_label.configure(image="", text="Could not display the teacher image.")

        image_overlay.deiconify()
        place_image_overlay()

    def update_announcement_overlay(text: str | None, suspended: bool = False):
        if not text or suspended:
            try:
                announcement_overlay.grab_release()
            except Exception:
                pass
            announcement_overlay.withdraw()
            return

        announcement_message.configure(text=text)
        announcement_overlay.deiconify()
        place_announcement_overlay()

    def set_banner_style(background: str, foreground: str, text: str):
        banner.configure(bg=background)
        frame.configure(bg=background)
        dot.configure(bg=background)
        dot.delete("all")
        dot.create_oval(1, 1, 11, 11, fill=foreground, outline=foreground)
        label.configure(text=text, bg=background, fg=foreground)

    def refresh():
        with _teacher_session_lock:
            active = teacher_session_active
            attention = attention_mode_active
            exam_mode = exam_mode_active
            blackout_active = screen_blackout_active
            input_lock_active = _system_input_block_enabled
            dashboard_connected = dashboard_connection_active
            consent_pending = classroom_consent_pending
            consent_accepted = classroom_consent_accepted
            consent_deadline = classroom_consent_deadline
            request_pending = screen_share_request_pending
            image_data = image_overlay_data
            announcement_text = announcement_overlay_text

        now = time.time()
        if consent_pending and consent_deadline is not None:
            remaining_seconds = max(0, math.ceil(consent_deadline - now))
            classroom_consent_countdown.configure(
                text=f"Shutdown in {remaining_seconds} second{'s' if remaining_seconds != 1 else ''}"
            )
            if consent_deadline <= now:
                decline_classroom_consent()
                root.after(200, refresh)
                return
        else:
            classroom_consent_countdown.configure(
                text=f"Shutdown in {CLASSROOM_CONSENT_TIMEOUT_SECONDS} seconds"
            )

        if blackout_active:
            blackout.deiconify()
            place_blackout()
        else:
            try:
                blackout.grab_release()
            except Exception:
                pass
            blackout.withdraw()

        if input_lock_active and not blackout_active:
            input_lock.deiconify()
            place_input_lock()
        else:
            try:
                input_lock.grab_release()
            except Exception:
                pass
            input_lock.withdraw()

        update_image_overlay(image_data)
        update_announcement_overlay(announcement_text, blackout_active or input_lock_active or bool(image_data))

        if consent_pending:
            classroom_consent_prompt.deiconify()
            place_classroom_consent_prompt()
        else:
            try:
                classroom_consent_prompt.grab_release()
            except Exception:
                pass
            classroom_consent_prompt.withdraw()

        if request_pending and not active:
            consent_prompt.deiconify()
            place_consent_prompt()
            consent_prompt.lift()
            try:
                consent_prompt.focus_force()
            except Exception:
                pass
        else:
            consent_prompt.withdraw()

        if dashboard_connected and consent_accepted:
            set_banner_style("#9f1a1a", "#fff4f4", "Being controlled by teacher")
            banner.deiconify()
            place_banner()
        elif exam_mode:
            set_banner_style("#1f1f1f", "#fff4f4", "Exam mode active")
            banner.deiconify()
            place_banner()
        elif attention:
            banner.withdraw()
        else:
            banner.withdraw()

        root.after(200, refresh)

    refresh()
    root.mainloop()


def set_teacher_session(active: bool):
    with _teacher_session_lock:
        global teacher_session_active
        teacher_session_active = active


def begin_classroom_consent():
    with _teacher_session_lock:
        global dashboard_connection_active
        global classroom_consent_pending
        global classroom_consent_accepted
        global classroom_consent_deadline
        dashboard_connection_active = True
        classroom_consent_pending = True
        classroom_consent_accepted = False
        classroom_consent_deadline = time.time() + CLASSROOM_CONSENT_TIMEOUT_SECONDS
        _classroom_consent_event.clear()


def clear_classroom_consent():
    with _teacher_session_lock:
        global dashboard_connection_active
        global classroom_consent_pending
        global classroom_consent_accepted
        global classroom_consent_deadline
        dashboard_connection_active = False
        classroom_consent_pending = False
        classroom_consent_accepted = False
        classroom_consent_deadline = None
    _classroom_consent_event.set()


def wait_for_classroom_consent() -> bool:
    _classroom_consent_event.wait()
    with _teacher_session_lock:
        return classroom_consent_accepted


def _shutdown_after_consent_decline():
    success, detail = shutdown_for_classroom_consent()
    set_update_state("Shutdown scheduled" if success else "Shutdown failed", detail)
    if success:
        time.sleep(0.2)
        os._exit(0)


def accept_classroom_consent():
    with _teacher_session_lock:
        global classroom_consent_pending
        global classroom_consent_accepted
        global classroom_consent_deadline
        classroom_consent_pending = False
        classroom_consent_accepted = True
        classroom_consent_deadline = None
    _classroom_consent_event.set()


def decline_classroom_consent():
    with _teacher_session_lock:
        should_shutdown = classroom_consent_pending or dashboard_connection_active
    clear_classroom_consent()
    if should_shutdown:
        threading.Thread(target=_shutdown_after_consent_decline, daemon=True).start()


def set_screen_share_request(active: bool):
    with _teacher_session_lock:
        global screen_share_request_pending
        global screen_share_declined
        screen_share_request_pending = active
        if active:
            screen_share_declined = False


def set_screen_share_declined(active: bool):
    with _teacher_session_lock:
        global screen_share_declined
        screen_share_declined = active
        if active:
            global screen_share_request_pending
            global teacher_session_active
            screen_share_request_pending = False
            teacher_session_active = False


def set_attention_mode(active: bool):
    with _teacher_session_lock:
        global attention_mode_active
        attention_mode_active = active


def set_screen_blackout(active: bool):
    with _teacher_session_lock:
        global screen_blackout_active
        screen_blackout_active = active


def enqueue_ui_event(event_name: str):
    try:
        _ui_event_queue.put_nowait(event_name)
    except Exception:
        pass


def approve_screen_share():
    with _teacher_session_lock:
        global teacher_session_active
        global screen_share_request_pending
        global screen_share_declined
        teacher_session_active = True
        screen_share_request_pending = False
        screen_share_declined = False
    enqueue_ui_event("screen_share_approved")


def decline_screen_share():
    with _teacher_session_lock:
        global teacher_session_active
        global screen_share_request_pending
        global screen_share_declined
        teacher_session_active = False
        screen_share_request_pending = False
        screen_share_declined = True
    enqueue_ui_event("screen_share_declined")


async def send_json(websocket, payload: dict, send_lock: asyncio.Lock):
    async with send_lock:
        await websocket.send(json.dumps(payload))


async def send_status(websocket, message_type: str, send_lock: asyncio.Lock):
    await send_json(
        websocket,
        {
            "type": message_type,
            "device": collect_status(),
        },
        send_lock,
    )


def build_activity_signature(foreground: dict[str, object]) -> str:
    return "|".join([
        str(foreground.get("processName", "")).strip().lower(),
        str(foreground.get("title", "")).strip().lower(),
        str(foreground.get("browserUrl", "")).strip().lower(),
        str(foreground.get("browserDomain", "")).strip().lower(),
    ])


async def heartbeat_loop(websocket, send_lock: asyncio.Lock):
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        await send_status(websocket, "heartbeat", send_lock)


async def ui_event_loop(websocket, send_lock: asyncio.Lock):
    while True:
        await asyncio.sleep(0.25)

        has_update = False
        while True:
            try:
                _ui_event_queue.get_nowait()
                has_update = True
            except queue.Empty:
                break

        if has_update:
            await send_status(websocket, "status", send_lock)


async def activity_monitor_loop(websocket, send_lock: asyncio.Lock):
    last_signature = ""

    while True:
        foreground = await asyncio.to_thread(get_foreground_window_info)
        current_signature = build_activity_signature(foreground)
        if last_signature:
            if current_signature != last_signature:
                await send_status(websocket, "status", send_lock)
        else:
            last_signature = current_signature

        last_signature = current_signature
        await asyncio.sleep(ACTIVITY_POLL_INTERVAL)


async def screen_frame_loop(websocket, send_lock: asyncio.Lock):
    last_crc = None

    while True:
        if not is_screen_share_active():
            last_crc = None
            await asyncio.sleep(0.5)
            continue

        frame, next_crc = await asyncio.to_thread(capture_screen_frame, last_crc)
        if next_crc is not None:
            last_crc = next_crc

        if frame:
            await send_json(
                websocket,
                {
                    "type": "screen_frame",
                    "frame": frame,
                },
                send_lock,
            )

        await asyncio.sleep(FRAME_INTERVAL)


async def thumbnail_loop(websocket, send_lock: asyncio.Lock):
    while True:
        frame, _ = await asyncio.to_thread(
            capture_screen_frame,
            None,
            THUMBNAIL_MAX_WIDTH,
            THUMBNAIL_MAX_HEIGHT,
            True,
        )
        if frame:
            await send_json(
                websocket,
                {
                    "type": "thumbnail_frame",
                    "frame": frame,
                },
                send_lock,
            )

        await asyncio.sleep(THUMBNAIL_INTERVAL)


async def management_loop():
    while True:
        policy = get_management_policy()
        set_system_input_block(bool(policy["inputLocked"]))

        if policy["allowedPrograms"] or policy["allowedSites"]:
            maybe_enforce_policy_once()

        await asyncio.sleep(1.0)


async def command_loop(websocket, send_lock: asyncio.Lock):
    async for raw in websocket:
        try:
            message = json.loads(raw)
        except json.JSONDecodeError:
            continue

        
        command_type = message.get("type")
        if command_type in {"remote_mouse_move", "remote_mouse_down", "remote_mouse_up", "remote_mouse_click", "remote_key", "type_text"}:
            if bool(get_management_policy().get("inputLocked")):
                continue

        if command_type == "screen_share_request" or command_type == "session_start":
            approve_screen_share()
            await send_status(websocket, "status", send_lock)
        elif command_type == "screen_share_cancel":
            set_teacher_session(False)
            set_screen_share_request(False)
            set_screen_share_declined(False)
            await send_status(websocket, "status", send_lock)
        elif command_type == "screen_share_end" or command_type == "session_end":
            set_teacher_session(False)
            set_screen_share_request(False)
            set_screen_share_declined(False)
            await send_status(websocket, "status", send_lock)
        elif command_type == "attention_all_on":
            set_attention_mode(True)
            await send_status(websocket, "status", send_lock)
        elif command_type == "attention_all_off":
            set_attention_mode(False)
            await send_status(websocket, "status", send_lock)
        elif command_type == "blackout_on" or command_type == "blackout_all_on":
            set_screen_blackout(True)
            await send_status(websocket, "status", send_lock)
        elif command_type == "blackout_off" or command_type == "blackout_all_off":
            set_screen_blackout(False)
            await send_status(websocket, "status", send_lock)
        elif command_type == "management_config":
            set_management_policy(
                normalize_rule_list(message.get("allowedPrograms")),
                normalize_rule_list(message.get("allowedSites")),
                normalize_website_mode(message.get("websiteMode")),
                bool(message.get("inputLocked")),
            )
        elif command_type == "remote_mouse_move":
            x = int(message.get("x", 0))
            y = int(message.get("y", 0))
            move_mouse_to(x, y)
        elif command_type == "remote_mouse_down":
            button = str(message.get("button", "left"))
            x = int(message.get("x", 0))
            y = int(message.get("y", 0))
            press_mouse_button(button, x, y)
        elif command_type == "remote_mouse_up":
            button = str(message.get("button", "left"))
            x = int(message.get("x", 0))
            y = int(message.get("y", 0))
            release_mouse_button(button, x, y)
        elif command_type == "remote_mouse_click":
            button = str(message.get("button", "left"))
            x = int(message.get("x", 0))
            y = int(message.get("y", 0))
            click_mouse(button, x, y)
        elif command_type == "remote_key":
            key = str(message.get("key", ""))
            modifiers = {
                "ctrl": bool(message.get("ctrl")),
                "alt": bool(message.get("alt")),
                "shift": bool(message.get("shift")),
                "meta": bool(message.get("meta")),
            }
            perform_remote_key(key, modifiers)
        elif command_type == "type_text":
            text = str(message.get("text", ""))
            if text:
                send_unicode_text(text)
        elif command_type == "open_website":
            success, detail = await asyncio.to_thread(open_website, str(message.get("url", "")))
            set_update_state("Opened website" if success else "Website launch failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "launch_program":
            success, detail = await asyncio.to_thread(launch_program, str(message.get("command", "")))
            set_update_state("Launched program" if success else "Program launch failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "set_volume":
            success, detail = await asyncio.to_thread(set_system_volume_level, message.get("level"))
            set_update_state("Volume changed" if success else "Volume change failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "play_audio":
            success, detail = await asyncio.to_thread(
                play_audio_file,
                str(message.get("filename", "")),
                str(message.get("data", "")),
            )
            set_update_state("Playing audio" if success else "Audio playback failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "stop_audio":
            success, detail = await asyncio.to_thread(stop_audio_playback)
            set_update_state("Stopped audio" if success else "Audio stop failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "lock_device":
            success, detail = await asyncio.to_thread(lock_workstation)
            set_update_state("Locked PC" if success else "Lock failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "restart_device":
            success, detail = await asyncio.to_thread(restart_computer)
            set_update_state("Restart scheduled" if success else "Restart failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "shutdown_device":
            success, detail = await asyncio.to_thread(shutdown_computer)
            set_update_state("Shutdown scheduled" if success else "Shutdown failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "agent_update":
            set_update_state("Preparing update", "Saving the new agent package.")
            await send_status(websocket, "status", send_lock)

            success, detail = await asyncio.to_thread(
                schedule_agent_update,
                str(message.get("filename", "")),
                str(message.get("data", "")),
            )
            if success:
                set_update_state("Applying", detail)
                await send_status(websocket, "status", send_lock)
                await asyncio.sleep(0.5)
                os._exit(0)

            set_update_state("Update failed", detail)
            await send_status(websocket, "status", send_lock)
        elif command_type == "display_image":
            data = message.get("data")
            if isinstance(data, str) and data.strip():
                set_image_overlay(data.strip())
                await send_status(websocket, "status", send_lock)
        elif command_type == "show_announcement":
            text = normalize_announcement_text(message.get("text"))
            if text:
                set_announcement_overlay(text)
                await send_status(websocket, "status", send_lock)
        elif command_type == "clear_announcement":
            set_announcement_overlay(None)
            await send_status(websocket, "status", send_lock)
        elif command_type == "clear_display_image":
            set_image_overlay(None)
            await send_status(websocket, "status", send_lock)
        elif command_type == "status_request":
            await send_status(websocket, "status", send_lock)


async def run_agent(explicit_master_url: str):
    while True:
        master_url, source = await asyncio.to_thread(resolve_master_url, explicit_master_url)
        if not master_url:
            write_agent_status("", "discovering", "Searching the local network for the teacher dashboard.")
            await asyncio.sleep(RECONNECT_DELAY)
            continue

        try:
            detail = "Connecting to the discovered teacher dashboard." if source == "discovered" else ""
            if source == "cached":
                detail = "Reusing the last discovered teacher dashboard."
            if source == "configured":
                detail = "Connecting to the configured teacher dashboard."

            write_agent_status(master_url, "connecting", detail)
            async with websockets.connect(
                master_url,
                ping_interval=20,
                ping_timeout=20,
                open_timeout=15,
                max_size=MAX_UPDATE_SIZE_BYTES,
            ) as websocket:
                begin_classroom_consent()
                write_agent_status(master_url, "connected", "Waiting for local classroom monitoring consent.")
                consent_granted = await asyncio.to_thread(wait_for_classroom_consent)
                if not consent_granted:
                    await websocket.close(code=1000, reason="Classroom monitoring consent was not accepted.")
                    await asyncio.sleep(RECONNECT_DELAY)
                    continue

                write_agent_status(master_url, "connected")
                if not explicit_master_url:
                    write_cached_master_url(master_url)
                send_lock = asyncio.Lock()
                await send_status(websocket, "hello", send_lock)

                heartbeat = asyncio.create_task(heartbeat_loop(websocket, send_lock))
                commands = asyncio.create_task(command_loop(websocket, send_lock))
                ui_events = asyncio.create_task(ui_event_loop(websocket, send_lock))
                activity = asyncio.create_task(activity_monitor_loop(websocket, send_lock))
                frames = asyncio.create_task(screen_frame_loop(websocket, send_lock))
                management = asyncio.create_task(management_loop())

                done, pending = await asyncio.wait(
                    {heartbeat, commands, ui_events, activity, frames, management},
                    return_when=asyncio.FIRST_COMPLETED,
                )

                for task in pending:
                    task.cancel()
                for task in done:
                    task.result()
        except Exception:
            write_agent_status(master_url, "disconnected", "The agent could not reach the teacher dashboard.")
            await asyncio.sleep(RECONNECT_DELAY)
        finally:
            clear_classroom_consent()
            set_teacher_session(False)
            set_screen_share_request(False)
            set_screen_share_declined(False)
            set_attention_mode(False)
            set_screen_blackout(False)
            set_management_policy([], [], "block", False)
            set_system_input_block(False)
            set_image_overlay(None)
            set_announcement_overlay(None)


def start_agent_thread(explicit_master_url: str) -> threading.Thread:
    thread = threading.Thread(
        target=lambda: asyncio.run(run_agent(explicit_master_url)),
        daemon=False,
    )
    thread.start()
    return thread


def main():
    if not ensure_installed_copy():
        return

    ensure_autostart()
    enable_dpi_awareness()
    wait_for_network()
    explicit_master_url = get_explicit_master_url()
    agent_thread = start_agent_thread(explicit_master_url)
    ensure_indicator()
    agent_thread.join()


if __name__ == "__main__":
    main()
