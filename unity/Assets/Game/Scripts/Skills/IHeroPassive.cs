using System;

namespace Spiritfire.Game
{
    /// <summary>
    /// 英雄被动（Three.js HeroDef.passive：name / description / apply(ctx) → 撤销函数）。
    /// <see cref="HeroDef.CreatePassive"/> 每次配置英雄时新建一份；<see cref="Apply"/> 装上（登记修饰器、订阅事件、加属性），
    /// 返回的句柄在换英雄 / 玩家销毁时 Dispose——要撤销干净（可以用 <see cref="SkillSession"/> 记撤销动作）。
    /// </summary>
    public interface IHeroPassive
    {
        string Name { get; }
        string Description { get; }
        IDisposable Apply(HeroSkills owner);
    }

    /// <summary>被动的便捷基类：在 <see cref="Install"/> 里往 <see cref="session"/> 登记撤销动作即可</summary>
    public abstract class HeroPassive : IHeroPassive
    {
        public abstract string Name { get; }
        public abstract string Description { get; }

        protected HeroSkills owner;
        protected SkillSession session;

        public IDisposable Apply(HeroSkills o)
        {
            owner = o;
            session = new SkillSession();
            session.Begin();
            try
            {
                Install();
            }
            catch
            {
                session.End(SkillEnd.Aborted);
                throw;
            }
            return new Handle(session);
        }

        /// <summary>装上被动：修饰器 / 订阅的句柄交给 session.Track</summary>
        protected abstract void Install();

        sealed class Handle : IDisposable
        {
            SkillSession s;
            public Handle(SkillSession s) => this.s = s;

            public void Dispose()
            {
                s?.End(SkillEnd.Interrupted);
                s = null;
            }
        }
    }
}
