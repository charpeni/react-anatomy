interface ToolbarProps {
  title: string;
  onExport: () => void;
  onPrint: () => void;
}

// Everything except `title` is handed on with a rest spread.
export function Toolbar({ title, ...actions }: ToolbarProps) {
  return (
    <header className="toolbar">
      <h1>{title}</h1>
      <ToolbarActions {...actions} />
    </header>
  );
}

// Reads onExport. onPrint arrives through the spread and stops here.
function ToolbarActions({ onExport }: Omit<ToolbarProps, 'title'>) {
  return <button onClick={onExport}>Export CSV</button>;
}
