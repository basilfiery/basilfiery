import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';

type TipoToast = 'info' | 'ok' | 'erro';
type FuncToast = (mensagem: string, tipo?: TipoToast) => void;

const Ctx = createContext<FuncToast>(() => {});

export function ProvedorToast({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<{ id: number; mensagem: string; tipo: TipoToast }[]>([]);

  const toast = useCallback<FuncToast>((mensagem, tipo = 'info') => {
    const id = Date.now() + Math.random();
    setLista((l) => [...l.slice(-2), { id, mensagem, tipo }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === 'erro' ? 6000 : 3000);
  }, []);

  return (
    <Ctx.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {lista.map((t) => (
          <div key={t.id} className={`toast toast--${t.tipo}`}>
            <span className="toast__icone" aria-hidden="true">
              {t.tipo === 'ok' ? <CircleCheck size={18} /> : t.tipo === 'erro' ? <CircleAlert size={18} /> : <Info size={18} />}
            </span>
            <span className="toast__texto">{t.mensagem}</span>
            <button type="button" className="toast__fechar" onClick={() => setLista((l) => l.filter((x) => x.id !== t.id))} aria-label="Fechar aviso"><X size={15} /></button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
