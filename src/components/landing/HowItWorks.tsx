const steps = [
  {
    n: 1,
    title: "Add Your Nodes",
    body: "Tap Conversation, Action, or End to drop a box onto the canvas. Each box is one step in your call.",
  },
  {
    n: 2,
    title: "Fill In the Script",
    body: "Open any node to add dialogue, label it, and define transitions to the next step.",
  },
  {
    n: 3,
    title: "Connect the Flow",
    body: "Drag from a node's handle to another to draw a connection. Click an arrow to delete it.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-b bg-muted/20">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            How It Works
          </span>
          <h2 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">
            Three steps to a Webespoke AI-ready script
          </h2>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <div
              key={s.n}
              className="rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-semibold">
                {s.n}
              </div>
              <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
