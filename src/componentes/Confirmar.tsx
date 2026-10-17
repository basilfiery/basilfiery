import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Modal } from './Modal';

interface Opcoes {
  titulo?: string;
  /** Texto do botão de confirmar (padrão: "Confirmar") */
  sim?: string;
  /** Botão vermelho, para excluir/cancelar */
  perigo?: boolean;
}

interface Pedido extends Opcoes {
  mensagem: string;
  responder: (ok: boolean) => void;
}

let abrir: ((p: Pedido) => void) | null = null;

/**
 * Pergunta "tem certeza?" com o visual do sistema.
 * Substitui o confirm() do navegador: no programa do Windows, depois daquela janelinha,
 * os campos de texto paravam de aceitar digitação.
 */
export function confirmar(mensagem: string, opcoes: Opcoes = {}): Promise<boolean> {
  if (!abrir) return Promise.resolve(window.confirm(mensagem));
  return new Promise((responder) => abrir!({ mensagem, ...opcoes, responder }));
}

export function ProvedorConfirmar({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<Pedido | null>(null);

  useEffect(() => {
    abrir = setPedido;
    return () => { abrir = null; };
  }, []);

  const responder = (ok: boolean) => {
    pedido?.responder(ok);
    setPedido(null);
  };

  // A mensagem pode vir com uma linha de aviso separada por linha em branco
  const [principal, ...extras] = (pedido?.mensagem ?? '').split('\n\n');

  return (
    <>
      {children}
      {pedido && (
        <Modal
          aberto
          aoFechar={() => responder(false)}
          largura={440}
          classe="pergunta-modal"
          rodape={
            <>
              <button className="btn btn--contorno" onClick={() => responder(false)}>Voltar</button>
              <button className={pedido.perigo ? 'btn btn--perigo-cheio' : 'btn btn--primario'} onClick={() => responder(true)} autoFocus>
                {pedido.sim ?? 'Confirmar'}
              </button>
            </>
          }
        >
          <div className="pergunta">
            <span className={pedido.perigo ? 'pergunta__icone pergunta__icone--perigo' : 'pergunta__icone'}>
              {pedido.perigo ? <AlertTriangle size={24} /> : <HelpCircle size={24} />}
            </span>
            <div>
              <h2>{pedido.titulo ?? principal}</h2>
              {pedido.titulo && <p>{principal}</p>}
              {extras.map((x, i) => <p key={i} className="pergunta__aviso">{x}</p>)}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
