using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    public static class GunfirePlayerBuild
    {
        [MenuItem("Spiritfire/Build/Gunfire Test Player")]
        public static void Run()
        {
            string output = Path.Combine(Directory.GetCurrentDirectory(), "Build", "GunfireTest", "GunfireTest.exe");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            var options = new BuildPlayerOptions
            {
                scenes = new[] { "Assets/Scenes/TestArena.unity" },
                locationPathName = output,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.Development | BuildOptions.AllowDebugging,
            };
            var report = BuildPipeline.BuildPlayer(options);
            if (report.summary.result != BuildResult.Succeeded)
                throw new System.InvalidOperationException($"Gunfire test player failed: {report.summary.result}");
            Debug.Log($"[Gunfire] Development player: {output}");
        }

        public static void Batch() => Run();
    }
}
