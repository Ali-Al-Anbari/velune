function App() {
  return (
    <main className="landing-shell min-h-svh overflow-hidden text-[#f4eaf7]">
      <div className="landing-inner mx-auto flex min-h-svh w-full max-w-6xl flex-col px-7 sm:px-12 lg:px-16">
        <header className="pt-[calc(env(safe-area-inset-top)+2.2rem)] sm:pt-14">
          <span className="brand-mark">velune</span>
        </header>

        <section className="hero relative flex flex-1 flex-col justify-center py-14 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16" aria-labelledby="hero-title">
          <div className="hero-copy relative z-10">
            <h1 id="hero-title" className="hero-title max-w-[10ch] text-[clamp(3.7rem,13.2vw,7.6rem)] leading-[0.94] tracking-[-0.055em] lg:max-w-none lg:text-[clamp(4.5rem,6.3vw,6rem)]">
              Make room<br />for what <em>matters.</em>
            </h1>
            <p className="mt-7 max-w-[29rem] text-lg leading-relaxed text-[#c9bfd0] sm:text-xl">
              A calmer way to keep your shifts and earnings in view. Coming soon.
            </p>
          </div>

          <div className="art-stage relative mt-10 h-[min(78vw,24rem)] min-h-64 w-full sm:mt-12 sm:h-[29rem] lg:mt-0 lg:h-[36rem]" aria-hidden="true">
            <div className="orb-glow" />
            <div className="orb" />
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit-dot" />
          </div>
        </section>

        <footer className="pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4 text-sm text-[#b6a4bd] sm:pb-10">
          Built for the rhythm of real life.
        </footer>
      </div>
    </main>
  )
}

export default App
