import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { ehErroDeCarregamento, recarregarLimpo, recarregarUmaVez } from '../lib/carregamento';
import { registrarErro } from '../lib/erros';

/* =====================================================================
   Nada pode deixar o sistema parado no meio do expediente:
   - ErroTela: se UMA tela quebrar, só ela mostra "tentar de novo";
     o resto (pedidos chegando, som, impressão, menu) continua funcionando.
   - ErroGeral: se o sistema inteiro quebrar, ele se recarrega SOZINHO
     em segundos (nenhum pedido se perde: tudo fica no servidor).
   Todo erro é registrado no banco para ser corrigido.
   ===================================================================== */

const CHAVE_TENTATIVAS = 'bf:recargas-por-erro';

/** Quantas recargas automáticas por erro aconteceram nos últimos 5 minutos (evita loop infinito) */
function recargasRecentes(): number[] {
  try {
    const lista = JSON.parse(sessionStorage.getItem(CHAVE_TENTATIVAS) || '[]') as number[];
    return lista.filter((t) => Date.now() - t < 5 * 60000);
  } catch { return []; }
}
function anotarRecarga() {
  try { sessionStorage.setItem(CHAVE_TENTATIVAS, JSON.stringify([...recargasRecentes(), Date.now()])); } catch { /* sem armazenamento */ }
}

interface Estado { erro: Error | null; segundos: number | null }

export class ErroGeral extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { erro: null, segundos: null };
  private relogio: ReturnType<typeof setInterval> | null = null;

  static getDerivedStateFromError(erro: Error): Partial<Estado> {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error('Erro na tela:', erro, info.componentStack);
    registrarErro(erro, 'tela-inteira', info.componentStack ?? undefined);
    if (ehErroDeCarregamento(erro) && recarregarUmaVez()) { this.setState({ segundos: 0 }); return; }
    // Recarrega sozinho em 3 segundos (até 3 vezes em 5 minutos; depois espera o clique)
    if (recargasRecentes().length < 3) {
      this.setState({ segundos: 3 });
      this.relogio = setInterval(() => {
        const s = (this.state.segundos ?? 1) - 1;
        if (s <= 0) {
          if (this.relogio) clearInterval(this.relogio);
          anotarRecarga();
          recarregarLimpo();
        }
        this.setState({ segundos: Math.max(0, s) });
      }, 1000);
    }
  }

  componentWillUnmount() {
    if (this.relogio) clearInterval(this.relogio);
  }

  render() {
    const { erro, segundos } = this.state;
    if (!erro) return this.props.children;
    const automatico = segundos !== null;

    return (
      <div className="erro-geral" role="alert">
        <img src="/favicon.png" alt="" width={56} height={56} />
        <h1>{automatico ? 'Voltando em instantes…' : 'Ops, algo não carregou direito'}</h1>
        <p>
          {automatico
            ? `Nenhum pedido foi perdido. O sistema está se recarregando sozinho${segundos ? ` em ${segundos}s` : ''}.`
            : 'Nenhum pedido foi perdido. Clique em recarregar para continuar de onde parou.'}
        </p>
        <button className="btn btn--primario btn--lg" onClick={() => { anotarRecarga(); recarregarLimpo(); }}>
          <RefreshCw size={18} /> {automatico ? 'Recarregar agora' : 'Recarregar'}
        </button>
        {!automatico && (
          <details>
            <summary>Detalhes para o suporte</summary>
            <code>{erro.message}</code>
          </details>
        )}
      </div>
    );
  }
}

/**
 * Proteção de uma tela só (ex.: o conteúdo do painel). Ao quebrar, mostra um aviso
 * no lugar da tela e tenta de novo sozinho uma vez; o restante do sistema segue normal.
 * Trocar de tela (chave diferente) limpa o erro.
 */
export class ErroTela extends Component<{ children: ReactNode; chave?: string; silencioso?: boolean }, { erro: Error | null; tentativas: number }> {
  state = { erro: null as Error | null, tentativas: 0 };
  private tempo: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error('Erro numa tela:', erro, info.componentStack);
    registrarErro(erro, 'tela', info.componentStack ?? undefined);
    if (ehErroDeCarregamento(erro)) { recarregarUmaVez(); return; }
    // Primeira falha: tenta montar a tela de novo sozinho (resolve dados que chegaram fora de ordem)
    if (this.state.tentativas < 1) this.tempo = setTimeout(() => this.setState((s) => ({ erro: null, tentativas: s.tentativas + 1 })), 1200);
  }

  componentDidUpdate(anterior: { chave?: string }) {
    if (anterior.chave !== this.props.chave && this.state.erro) this.setState({ erro: null, tentativas: 0 });
  }

  componentWillUnmount() {
    if (this.tempo) clearTimeout(this.tempo);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    if (this.props.silencioso) return null; // avisos pequenos: some, tenta de novo e o resto segue
    const tentando = this.state.tentativas < 1;
    return (
      <div className="erro-tela" role="alert">
        <RefreshCw size={26} className={tentando ? 'girando' : undefined} />
        <strong>{tentando ? 'Recarregando esta tela…' : 'Esta tela teve um problema'}</strong>
        <p>Os pedidos continuam chegando normalmente. {tentando ? '' : 'Tente abrir de novo.'}</p>
        {!tentando && (
          <div className="erro-tela__acoes">
            <button className="btn btn--primario" onClick={() => this.setState({ erro: null, tentativas: 0 })}>Tentar de novo</button>
            <button className="btn btn--contorno" onClick={() => { anotarRecarga(); recarregarLimpo(); }}>Recarregar o sistema</button>
          </div>
        )}
      </div>
    );
  }
}
