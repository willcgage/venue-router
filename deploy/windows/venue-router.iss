; Inno Setup script for the Venue Router Windows installer.
; Built by deploy/build-package.js, which passes AppVersion, Stage (the folder of files to install) and OutDir.
;
; What the installer does:
;   - puts the app, its libraries and its own copy of Node.js in Program Files
;   - keeps the saved setup apart, in C:\ProgramData\Venue Router, so an update never touches it
;   - registers a "Venue Router" task that starts the app with Windows, as the Local Service account
;   - if asked, adds one firewall rule so other devices on the network can open it
; Silent install:  VenueRouter-setup.exe /VERYSILENT /SUPPRESSMSGBOXES [/TASKS="network"] [/PORT=8787]

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Stage
  #define Stage "..\..\dist\stage"
#endif
#ifndef OutDir
  #define OutDir "..\..\dist"
#endif

[Setup]
AppId={{6C0E3B0A-52B7-4E0B-9C0D-5B5F0E6B7A41}
AppName=Venue Router
AppVersion={#AppVersion}
AppVerName=Venue Router {#AppVersion}
AppPublisher=Venue Router
DefaultDirName={autopf}\Venue Router
DefaultGroupName=Venue Router
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutDir}
OutputBaseFilename=VenueRouter-{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
UninstallDisplayName=Venue Router

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "network"; Description: "Let phones, tablets and other computers on the network open it"; GroupDescription: "Who can open Venue Router:"

[InstallDelete]
; Libraries from the version being replaced
Type: filesandordirs; Name: "{app}\node_modules"

[Files]
Source: "{#Stage}\deploy\windows\service.ps1"; Flags: dontcopy
Source: "{#Stage}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Venue Router"; Filename: "{app}\Venue Router.url"
Name: "{group}\Venue Router log"; Filename: "{commonappdata}\Venue Router\logs\venue-router.log"

[Run]
Filename: "{app}\Venue Router.url"; Description: "Open Venue Router now"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\deploy\windows\service.ps1"" -Action uninstall -AppDir ""{app}"""; Flags: runhidden; RunOnceId: "VenueRouterStop"

[UninstallDelete]
Type: files; Name: "{app}\Venue Router.url"

[Messages]
FinishedLabel=Venue Router is installed and running. It starts by itself whenever this computer starts.%n%nOpen it on this computer first: if it has not been set up yet it will ask for the addresses of your router and switcher. Then set an Engineer PIN under Spaces.

[Code]
function Helper(const ScriptPath, Action, Extra: String): Integer;
var
  Code: Integer;
begin
  if not Exec('powershell.exe',
      '-NoProfile -ExecutionPolicy Bypass -File "' + ScriptPath + '" -Action ' + Action + ' -AppDir "' + ExpandConstant('{app}') + '"' + Extra,
      '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  Result := Code;
end;

// Stop the copy that is running (this version or an earlier one) before its files are replaced.
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  ExtractTemporaryFile('service.ps1');
  if Helper(ExpandConstant('{tmp}\service.ps1'), 'stop', '') <> 0 then
    Result := 'Setup could not stop the copy of Venue Router that is already running. Close it and run Setup again.';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Extra: String;
begin
  if CurStep = ssPostInstall then
  begin
    Extra := ' -Port ' + ExpandConstant('{param:PORT|0}');
    if WizardIsTaskSelected('network') then
      Extra := Extra + ' -Network';
    if Helper(ExpandConstant('{app}\deploy\windows\service.ps1'), 'install', Extra) <> 0 then
      SuppressibleMsgBox('The files were installed, but Venue Router could not be started.' + #13#10 + #13#10 +
        'The reason is in ' + ExpandConstant('{commonappdata}') + '\Venue Router\logs\install.log', mbError, MB_OK, IDOK);
  end;
end;
