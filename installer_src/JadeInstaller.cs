using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

class JadeInstaller {
    static Label statusLabel;
    static Form form;

    [STAThread]
    static int Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        form = new Form();
        form.Text = "Jade Installer";
        form.ClientSize = new Size(420, 130);
        form.FormBorderStyle = FormBorderStyle.FixedDialog;
        form.MaximizeBox = false;
        form.MinimizeBox = false;
        form.StartPosition = FormStartPosition.CenterScreen;
        form.BackColor = Color.FromArgb(13, 17, 23);

        var titleLabel = new Label();
        titleLabel.Text = "Jade  —  your offline second brain";
        titleLabel.ForeColor = Color.FromArgb(139, 148, 158);
        titleLabel.Font = new Font("Segoe UI", 9f);
        titleLabel.SetBounds(20, 14, 380, 22);
        titleLabel.TextAlign = ContentAlignment.MiddleLeft;
        form.Controls.Add(titleLabel);

        statusLabel = new Label();
        statusLabel.Text = "Preparing...";
        statusLabel.ForeColor = Color.FromArgb(62, 192, 98);
        statusLabel.Font = new Font("Segoe UI", 12f);
        statusLabel.SetBounds(20, 46, 380, 30);
        statusLabel.TextAlign = ContentAlignment.MiddleLeft;
        form.Controls.Add(statusLabel);

        var hintLabel = new Label();
        hintLabel.Text = "This may take a few minutes on first run.";
        hintLabel.ForeColor = Color.FromArgb(70, 78, 90);
        hintLabel.Font = new Font("Segoe UI", 8.5f);
        hintLabel.SetBounds(20, 88, 380, 20);
        form.Controls.Add(hintLabel);

        var worker = new Thread(RunInstall);
        worker.IsBackground = true;
        worker.Start();

        Application.Run(form);
        return 0;
    }

    static void SetStatus(string msg) {
        if (form == null || form.IsDisposed) return;
        if (form.InvokeRequired)
            form.Invoke(new Action<string>(SetStatus), msg);
        else
            statusLabel.Text = msg;
    }

    static void CloseForm() {
        if (form == null || form.IsDisposed) return;
        if (form.InvokeRequired) form.Invoke(new Action(CloseForm));
        else form.Close();
    }

    static void RunInstall() {
        string exeDir    = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
        string archive   = Path.Combine(exeDir, "jade_files.7z");
        string sevenZa   = Path.Combine(exeDir, "7za.exe");
        string installDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "Jade");

        if (!File.Exists(archive)) {
            MessageBox.Show("jade_files.7z not found next to the installer.", "Jade Installer",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            CloseForm(); return;
        }
        if (!File.Exists(sevenZa)) {
            MessageBox.Show("7za.exe not found next to the installer.", "Jade Installer",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            CloseForm(); return;
        }

        SetStatus("Extracting files...");
        Directory.CreateDirectory(installDir);

        var p = new Process();
        p.StartInfo = new ProcessStartInfo {
            FileName  = sevenZa,
            Arguments = "x \"" + archive + "\" -o\"" + installDir + "\" -y",
            UseShellExecute = false,
            CreateNoWindow  = true,
        };
        p.Start();
        p.WaitForExit();

        if (p.ExitCode != 0) {
            MessageBox.Show("Extraction failed (7za code " + p.ExitCode + ").", "Jade Installer",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            CloseForm(); return;
        }

        SetStatus("Creating shortcut...");
        string jadeExe = Path.Combine(installDir, "Jade.exe");
        string desktop  = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string lnkPath  = Path.Combine(desktop, "Jade.lnk");
        try {
            Type   shellType = Type.GetTypeFromProgID("WScript.Shell");
            dynamic wsh = Activator.CreateInstance(shellType);
            dynamic lnk = wsh.CreateShortcut(lnkPath);
            lnk.TargetPath       = jadeExe;
            lnk.WorkingDirectory = installDir;
            lnk.Description      = "Jade — your offline second brain";
            lnk.Save();
        } catch {}

        SetStatus("Registering...");
        try {
            string uninstallKey = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Jade";
            string uninstallCmd = "powershell.exe -WindowStyle Hidden -Command \""
                + "Remove-Item -LiteralPath '" + installDir + "' -Recurse -Force; "
                + "Remove-Item -LiteralPath '" + lnkPath + "' -Force -ErrorAction SilentlyContinue; "
                + "Remove-Item -Path 'HKCU:\\\\Software\\\\Microsoft\\\\Windows\\\\CurrentVersion\\\\Uninstall\\\\Jade' -Recurse -Force -ErrorAction SilentlyContinue"
                + "\"";
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(uninstallKey)) {
                key.SetValue("DisplayName",     "Jade");
                key.SetValue("DisplayVersion",  "1.0.0");
                key.SetValue("Publisher",       "Mrigul Arora");
                key.SetValue("InstallLocation", installDir);
                key.SetValue("DisplayIcon",     jadeExe + ",0");
                key.SetValue("UninstallString", uninstallCmd);
                key.SetValue("NoModify",        1, RegistryValueKind.DWord);
                key.SetValue("NoRepair",        1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize",   9000000, RegistryValueKind.DWord);
            }
        } catch {}

        SetStatus("Done! Launching Jade...");
        Thread.Sleep(1200);

        try {
            Process.Start(new ProcessStartInfo { FileName = jadeExe, UseShellExecute = true });
        } catch {}
        Thread.Sleep(400);
        CloseForm();
    }
}
