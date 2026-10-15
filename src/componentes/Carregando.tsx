export function Carregando({ texto }: { texto?: string }) {
  return (
    <div className="carregando" role="status">
      <div className="spinner" />
      {texto && <p>{texto}</p>}
    </div>
  );
}
