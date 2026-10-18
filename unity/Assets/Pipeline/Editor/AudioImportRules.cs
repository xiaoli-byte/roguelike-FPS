using UnityEditor;
using UnityEngine;

namespace Spiritfire.Art.Editor
{
    /// <summary>
    /// 烘焙音频的导入设置（Resources/Audio，见 scripts/audio/bake.py）：
    ///   Sfx   短片段：载入时解压（播放不占 CPU 解码）、强制单声道（3D 声像在运行时做）、预加载
    ///   Music 长曲：流式播放、不预加载
    /// </summary>
    public sealed class AudioImportRules : AssetPostprocessor
    {
        void OnPreprocessAudio()
        {
            var path = assetPath.Replace('\\', '/');
            if (!path.Contains("/Resources/Audio/")) return;
            var imp = (AudioImporter)assetImporter;
            var s = imp.defaultSampleSettings;
            s.compressionFormat = AudioCompressionFormat.Vorbis;
            if (path.Contains("/Audio/Music/"))
            {
                s.loadType = AudioClipLoadType.Streaming;
                s.quality = 0.6f;
                s.preloadAudioData = false;
                imp.forceToMono = false;
                imp.loadInBackground = true;
            }
            else
            {
                s.loadType = AudioClipLoadType.DecompressOnLoad;
                s.quality = 0.7f;
                s.preloadAudioData = true;
                imp.forceToMono = true;
            }
            imp.defaultSampleSettings = s;
        }
    }
}
