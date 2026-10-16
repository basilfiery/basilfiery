import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ehErroDeCarregamento, recarregarLimpo, recarregarUmaVez } from '../lib/carregamento';

interface Estado { erro: Error | null; recarregando: boolean }

/**
 * Se qualquer parte do sistema quebrar, mostra uma tela com "Recarregar"
 * em vez de deixar a tela vazia. Falhas de carregamento (pós-atualização)
 * se resolvem sozinhas com uma recarga automática.
 */
export class ErroGeral extends Component<{ children: ReactNode }, Estado> {
  state: Estado = { erro: null, recarregando: false };

  static getDerivedStateFromError(erro: Error): Partial<Estado> {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error('Erro na tela:', erro, info.componentStack);
    if (ehErroDeCarregamento(erro) && recarregarUmaVez()) this.setState({ recarregando: true });
  }

  render() {
    const { erro, recarregando } = this.state;
    if (!erro) return this.props.children;

    return (
      <div className="erro-geral" role="alert">
        <img src="/favicon.png" alt="" width={56} height={56} />
        <h1>{recarregando ? 'Atualizando o BasilFiery…' : 'Ops, algo não carregou direito'}</h1>
        <p>
          {recarregando
            ? 'Só um instante, estamos buscando a versão mais nova.'
            : 'Nenhum pedido foi perdido. Clique em recarregar para continuar de onde parou.'}
        </p>
        {!recarregando && (
          <>
            <button className="btn btn--primario btn--lg" onClick={recarregarLimpo}>Recarregar</button>
            <details>
              <summary>Detalhes para o suporte</summary>
              <code>{erro.message}</code>
            </details>
          </>
        )}
      </div>
    );
  }
}
