; Sentry setup wizard (SentrySetup.exe) for Windows 11 x64.
; It installs the same verified archive the release ZIP holds, then runs the archive's own setup
; one step at a time (scripts/distribution/wizard.ps1): WSL2, Ubuntu with its Linux account, the
; Linux tools, the Sentry runtime and the agent tools. When Windows must restart for WSL2, the
; wizard registers itself to continue after the next sign-in.
; Built by scripts/distribution/installer/build.mjs, which passes the defines below.

#ifndef AppVersion
  #error AppVersion is required (build with scripts/distribution/installer/build.mjs)
#endif
#ifndef Sha12
  #error Sha12 is required
#endif
#ifndef SourceDir
  #error SourceDir is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif
#define ArchiveName "sentry-" + AppVersion + "-" + Sha12 + "-windows-x64"

[Setup]
AppId={{8F3B6D2A-5C1E-4B7A-9D2F-1E6C4A8B7D30}
AppName=Sentry
AppVersion={#AppVersion}
AppVerName=Sentry {#AppVersion}
AppPublisher=Sentry
AppPublisherURL=https://github.com/Mert1026/Sentry
VersionInfoVersion={#AppVersion}
; The same per-version folder the manual ZIP install uses, so `sentry update` works the same way.
DefaultDirName={localappdata}\Sentry\distributions\{#Sha12}\{#ArchiveName}
UsePreviousAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=no
; The welcome page explains what will happen (admin prompt, possible restart, time).
DisableWelcomePage=no
; The archive checks its own file list, so the uninstaller lives outside it.
UninstallFilesDir={localappdata}\Sentry\uninstall\{#Sha12}
UninstallDisplayIcon={app}\desktop\Sentry.exe
UninstallDisplayName=Sentry {#AppVersion}
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.22000
SetupIconFile=..\..\..\apps\desktop\assets\sentry-icon.ico
WizardStyle=modern
WizardSmallImageFile=..\..\..\apps\desktop\assets\sentry-icon.png
; The Sentry logo on a light panel, 2x the 164x314 side area for high-DPI screens.
WizardImageFile=wizard-side.png
Compression=lzma2/max
SolidCompression=yes
OutputDir={#OutputDir}
OutputBaseFilename=SentrySetup-{#AppVersion}-{#Sha12}-windows-x64
ShowLanguageDialog=auto

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "bg"; MessagesFile: "compiler:Languages\Bulgarian.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\Sentry"; Filename: "{app}\desktop\Sentry.exe"; Parameters: "--sentry-app"; WorkingDir: "{app}\desktop"
Name: "{userdesktop}\Sentry"; Filename: "{app}\desktop\Sentry.exe"; Parameters: "--sentry-app"; WorkingDir: "{app}\desktop"; Tasks: desktopicon

[Run]
Filename: "{app}\desktop\Sentry.exe"; Parameters: "--sentry-app"; WorkingDir: "{app}\desktop"; Description: "{cm:LaunchSentry}"; Flags: postinstall nowait skipifsilent; Check: SetupFinished

[CustomMessages]
en.WelcomeExtra=This wizard installs Sentry and everything it needs: WSL2, Ubuntu, the Linux tools and the agent tools.%n%nOn a new PC it takes 10 to 30 minutes and needs an internet connection. Windows asks once for administrator approval and may need one restart; setup then continues by itself.
en.StepCheck=Checking your PC
en.StepWsl=Installing WSL2
en.StepUbuntu=Installing Ubuntu
en.StepLinux=Preparing the Linux tools
en.StepCore=Installing the Sentry runtime
en.StepTools=Installing the agent tools
en.SettingUp=Setting up Sentry
en.SettingUpDesc=Keep this window open. Finished steps are skipped if you run setup again.
en.StepOf=Step %1 of %2: %3
en.CannotRun=This PC cannot run Sentry yet:%n%n%1
en.Cancelled=Windows did not get administrator approval, so WSL2 was not installed. Run this setup again when you are ready.
en.Failed=Setup stopped at "%1".%n%n%2%n%nThe full log is in:%n%3%n%nFix the problem and run this setup again; finished steps are skipped.
en.RebootNeeded=Windows needs to restart to finish installing WSL2. After you sign in again, Sentry setup continues by itself.
en.FinishedOk=Sentry is installed.%n%nOpen it, add your provider keys in Settings → Providers, and start your first QA run.
en.FinishedFailed=Sentry is not fully set up yet. Run this setup again to continue where it stopped.
en.LaunchSentry=Open Sentry
en.TechnicalDetail=Technical detail: %1
; Status and problem codes sent by wizard.ps1 (MSG/FAIL lines), %1 and %2 are their arguments.
en.WCheckWindowsOk=Windows 11 x64 (build %1)
en.WCheckWindowsFail=Sentry needs Windows 11 on a 64-bit Intel or AMD processor.
en.WCheckVirtOk=Hardware virtualization is on
en.WCheckVirtFail=Hardware virtualization is off. Turn on Intel VT-x or AMD-V (SVM) in the BIOS/UEFI settings, then run this setup again.
en.WCheckDiskLow=Only %1 GB of disk space is free; Sentry and Ubuntu need about 10 GB.
en.WCheckDistroOk=Linux distribution found: %1
en.WCheckUbuntuTodo=WSL is installed; Ubuntu will be installed next.
en.WCheckWslTodo=WSL2 and Ubuntu will be installed next.
en.WWslPresent=WSL is already installed.
en.WWslInstalling=Installing WSL2. Approve the Windows administrator prompt…
en.WWslFailed=WSL2 could not be installed (error %1). Check Windows Update and your internet connection.
en.WWslRestart=WSL2 is installed. Windows needs to restart; setup continues by itself after you sign in again.
en.WUbuntuInstalling=Downloading and installing Ubuntu. This takes a few minutes…
en.WUbuntuFailed=Ubuntu could not be installed. Check your internet connection.
en.WDistroRestart=%1 cannot start yet. Windows needs to restart; setup continues by itself after you sign in again.
en.WAccountCreating=Creating the Linux account "%1" in %2…
en.WAccountFailed=The Linux account in %1 could not be created.
en.WDistroReady=%1 is ready.
en.WNoDistro=No Linux distribution was chosen yet. Run this setup again.
en.WLinuxPreparing=Installing Node 22, pnpm, systemd, bubblewrap and socat in %1…
en.WLinuxFailed=The Linux tools could not be installed in %1. Check your internet connection.
en.WCoreInstalling=Installing the Sentry runtime inside WSL. This takes several minutes…
en.WCoreFailed=The Sentry runtime could not be installed.
en.WToolsInstalling=Installing the agent tools (OpenCode, DeepSeek, Claude Code)…
en.WToolsFailed=The agent tools could not be installed.
en.WUnexpected=An unexpected error occurred.
bg.WelcomeExtra=Този съветник инсталира Sentry и всичко необходимо: WSL2, Ubuntu, инструментите за Linux и инструментите на агентите.%n%nНа нов компютър отнема от 10 до 30 минути и изисква интернет връзка. Windows ще поиска еднократно администраторско одобрение и може да се наложи един рестарт; след това инсталацията продължава сама.
bg.StepCheck=Проверка на компютъра
bg.StepWsl=Инсталиране на WSL2
bg.StepUbuntu=Инсталиране на Ubuntu
bg.StepLinux=Подготовка на инструментите за Linux
bg.StepCore=Инсталиране на средата на Sentry
bg.StepTools=Инсталиране на инструментите на агентите
bg.SettingUp=Настройване на Sentry
bg.SettingUpDesc=Не затваряйте този прозорец. Завършените стъпки се пропускат, ако стартирате инсталацията отново.
bg.StepOf=Стъпка %1 от %2: %3
bg.CannotRun=Този компютър все още не може да стартира Sentry:%n%n%1
bg.Cancelled=Windows не получи администраторско одобрение, затова WSL2 не беше инсталиран. Стартирайте инсталацията отново, когато сте готови.
bg.Failed=Инсталацията спря на „%1“.%n%n%2%n%nПълният дневник е в:%n%3%n%nОтстранете проблема и стартирайте инсталацията отново; завършените стъпки се пропускат.
bg.RebootNeeded=Windows трябва да се рестартира, за да завърши инсталирането на WSL2. След като влезете отново, инсталацията на Sentry продължава сама.
bg.FinishedOk=Sentry е инсталиран.%n%nОтворете го, добавете ключовете на доставчиците в Настройки → Доставчици и стартирайте първата си QA проверка.
bg.FinishedFailed=Sentry все още не е напълно настроен. Стартирайте инсталацията отново, за да продължи оттам, където е спряла.
bg.LaunchSentry=Отвори Sentry
bg.TechnicalDetail=Технически подробности: %1
bg.WCheckWindowsOk=Windows 11 x64 (компилация %1)
bg.WCheckWindowsFail=Sentry изисква Windows 11 на 64-битов процесор на Intel или AMD.
bg.WCheckVirtOk=Хардуерната виртуализация е включена
bg.WCheckVirtFail=Хардуерната виртуализация е изключена. Включете Intel VT-x или AMD-V (SVM) в настройките на BIOS/UEFI и стартирайте инсталацията отново.
bg.WCheckDiskLow=Свободни са само %1 GB; Sentry и Ubuntu се нуждаят от около 10 GB.
bg.WCheckDistroOk=Намерена Linux дистрибуция: %1
bg.WCheckUbuntuTodo=WSL е инсталиран; следва инсталиране на Ubuntu.
bg.WCheckWslTodo=Следва инсталиране на WSL2 и Ubuntu.
bg.WWslPresent=WSL вече е инсталиран.
bg.WWslInstalling=Инсталиране на WSL2. Потвърдете администраторския прозорец на Windows…
bg.WWslFailed=WSL2 не можа да бъде инсталиран (грешка %1). Проверете Windows Update и интернет връзката.
bg.WWslRestart=WSL2 е инсталиран. Windows трябва да се рестартира; инсталацията продължава сама, след като влезете отново.
bg.WUbuntuInstalling=Изтегляне и инсталиране на Ubuntu. Това отнема няколко минути…
bg.WUbuntuFailed=Ubuntu не можа да бъде инсталиран. Проверете интернет връзката.
bg.WDistroRestart=%1 все още не може да стартира. Windows трябва да се рестартира; инсталацията продължава сама, след като влезете отново.
bg.WAccountCreating=Създаване на Linux акаунта „%1“ в %2…
bg.WAccountFailed=Linux акаунтът в %1 не можа да бъде създаден.
bg.WDistroReady=%1 е готов.
bg.WNoDistro=Все още не е избрана Linux дистрибуция. Стартирайте инсталацията отново.
bg.WLinuxPreparing=Инсталиране на Node 22, pnpm, systemd, bubblewrap и socat в %1…
bg.WLinuxFailed=Инструментите за Linux не можаха да бъдат инсталирани в %1. Проверете интернет връзката.
bg.WCoreInstalling=Инсталиране на средата на Sentry в WSL. Това отнема няколко минути…
bg.WCoreFailed=Средата на Sentry не можа да бъде инсталирана.
bg.WToolsInstalling=Инсталиране на инструментите на агентите (OpenCode, DeepSeek, Claude Code)…
bg.WToolsFailed=Инструментите на агентите не можаха да бъдат инсталирани.
bg.WUnexpected=Възникна неочаквана грешка.

[Code]
const
  StepCount = 6;
  ExitReboot = 75;
  ExitCancelled = 10;
  ExitCannotRun = 11;
  ResumeValue = 'SentrySetupResume';
  RunOnceKey = 'Software\Microsoft\Windows\CurrentVersion\RunOnce';

var
  ProgressPage: TOutputProgressWizardPage;
  Resuming, Finished, RebootPending: Boolean;
  CurrentStepTitle, LastLine, ProblemLines: String;

function SetupFinished: Boolean;
begin
  Result := Finished;
end;

function NeedRestart: Boolean;
begin
  Result := RebootPending;
end;

function InitializeSetup: Boolean;
var
  I: Integer;
begin
  Resuming := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/resume') = 0 then
      Resuming := True;
  Result := True;
end;

procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption := CustomMessage('WelcomeExtra');
  ProgressPage := CreateOutputProgressPage(CustomMessage('SettingUp'), CustomMessage('SettingUpDesc'));
end;

{ After a restart the person already chose everything: go straight to installing. }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := Resuming and ((PageID = wpWelcome) or (PageID = wpSelectTasks) or (PageID = wpReady));
end;

{ Turns a wizard.ps1 code line ("Code|arg1|arg2") into text in the chosen language. }
function TranslateCode(Line: String): String;
var
  Args: array[0..1] of String;
  Code: String;
  I, P: Integer;
begin
  P := Pos('|', Line);
  if P = 0 then
  begin
    Code := Line;
    Line := '';
  end
  else
  begin
    Code := Copy(Line, 1, P - 1);
    Line := Copy(Line, P + 1, Length(Line));
  end;
  for I := 0 to 1 do
  begin
    P := Pos('|', Line);
    if P = 0 then
    begin
      Args[I] := Line;
      Line := '';
    end
    else
    begin
      Args[I] := Copy(Line, 1, P - 1);
      Line := Copy(Line, P + 1, Length(Line));
    end;
  end;
  Result := FmtMessage(CustomMessage('W' + Code), [Args[0], Args[1]]);
end;

{ "MSG <code>" is the current status, "FAIL <code>" a problem to report; indented lines are
  technical output that only goes to the log (the last one is kept for error reports). }
procedure OnStepOutput(const S: String; const Error, FirstLine: Boolean);
var
  Text: String;
begin
  if Pos('MSG ', S) = 1 then
  begin
    Text := TranslateCode(Trim(Copy(S, 5, Length(S))));
    ProgressPage.SetText(CurrentStepTitle, Text);
  end
  else if Pos('FAIL ', S) = 1 then
  begin
    Text := TranslateCode(Trim(Copy(S, 6, Length(S))));
    ProblemLines := ProblemLines + Text + #13#10;
    ProgressPage.SetText(CurrentStepTitle, Text);
  end
  else if (Pos('  ', S) = 1) and (Trim(S) <> '') then
    LastLine := Trim(S);
end;

{ Runs one wizard.ps1 step and returns its exit code. }
function RunStep(Index: Integer; const Name, TitleMessage: String): Integer;
var
  Params: String;
  Code: Integer;
begin
  CurrentStepTitle := FmtMessage(CustomMessage('StepOf'), [IntToStr(Index), IntToStr(StepCount), CustomMessage(TitleMessage)]);
  ProgressPage.SetText(CurrentStepTitle, '');
  ProgressPage.SetProgress(Index - 1, StepCount);
  LastLine := '';
  ProblemLines := '';
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\scripts\distribution\wizard.ps1') + '" -Step ' + Name;
  if not ExecAndLogOutput('powershell.exe', Params, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, Code, @OnStepOutput) then
    Code := -1;
  Result := Code;
end;

procedure RegisterResume;
var
  Target: String;
begin
  Target := ExpandConstant('{localappdata}\Sentry\installer\SentrySetup.exe');
  ForceDirectories(ExtractFileDir(Target));
  if CompareText(ExpandConstant('{srcexe}'), Target) <> 0 then
    FileCopy(ExpandConstant('{srcexe}'), Target, False);
  RegWriteStringValue(HKEY_CURRENT_USER, RunOnceKey, ResumeValue, '"' + Target + '" /resume /LANG=' + ActiveLanguage);
end;

procedure RunSetupSteps;
var
  Names, Titles: array of String;
  I, Code: Integer;
  Detail: String;
begin
  SetArrayLength(Names, StepCount);
  SetArrayLength(Titles, StepCount);
  Names[0] := 'check';  Titles[0] := 'StepCheck';
  Names[1] := 'wsl';    Titles[1] := 'StepWsl';
  Names[2] := 'ubuntu'; Titles[2] := 'StepUbuntu';
  Names[3] := 'linux';  Titles[3] := 'StepLinux';
  Names[4] := 'core';   Titles[4] := 'StepCore';
  Names[5] := 'tools';  Titles[5] := 'StepTools';
  RegDeleteValue(HKEY_CURRENT_USER, RunOnceKey, ResumeValue);
  ProgressPage.Show;
  try
    for I := 0 to StepCount - 1 do
    begin
      Code := RunStep(I + 1, Names[I], Titles[I]);
      if Code = 0 then
        Continue;
      if Code = ExitReboot then
      begin
        RebootPending := True;
        RegisterResume;
        MsgBox(CustomMessage('RebootNeeded'), mbInformation, MB_OK);
        Exit;
      end;
      if Code = ExitCancelled then
      begin
        MsgBox(CustomMessage('Cancelled'), mbError, MB_OK);
        Exit;
      end;
      if Code = ExitCannotRun then
      begin
        MsgBox(FmtMessage(CustomMessage('CannotRun'), [ProblemLines]), mbError, MB_OK);
        Exit;
      end;
      Detail := ProblemLines;
      if Detail = '' then
        Detail := CustomMessage('WUnexpected') + #13#10;
      { The last technical line is often the real cause (in English, as the tool printed it). }
      if LastLine <> '' then
        Detail := Detail + #13#10 + FmtMessage(CustomMessage('TechnicalDetail'), [LastLine]);
      MsgBox(FmtMessage(CustomMessage('Failed'), [CustomMessage(Titles[I]), Detail, ExpandConstant('{localappdata}\Sentry\logs\setup-wizard.log')]), mbError, MB_OK);
      Exit;
    end;
    ProgressPage.SetProgress(StepCount, StepCount);
    Finished := True;
  finally
    ProgressPage.Hide;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    RunSetupSteps;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and not RebootPending then
  begin
    if Finished then
      WizardForm.FinishedLabel.Caption := CustomMessage('FinishedOk')
    else
      WizardForm.FinishedLabel.Caption := CustomMessage('FinishedFailed');
  end;
end;
