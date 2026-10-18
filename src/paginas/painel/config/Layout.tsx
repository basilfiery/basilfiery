import { type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { Switch } from '../../../componentes/Basicos';
import { cx } from '../../../lib/util';

export interface Passo { id: string; rotulo: string; titulo?: string; dica?: string }

/** Passo atual guardado no endereço (?passo=...), para o link abrir direto nele. */
export function usePasso(passos: Passo[]) {
  const [params, setParams] = useSearchParams();
  const atual = passos.find((p) => p.id === params.get('passo')) ?? passos[0];
  const ir = (id: string) => setParams((p) => { p.set('passo', id); return p; }, { replace: true });
  return [atual, ir] as const;
}

/**
 * Página de configuração no estilo do Anota AI: título com trilha, lista de
 * passos numerados à esquerda, cartão do passo à direita e barra "Salvar" fixa embaixo.
 */
export function PaginaConfig({ titulo, passos, atual, aoPasso, children, salvar, lateral }: {
  titulo: string;
  passos?: Passo[];
  atual?: Passo;
  aoPasso?: (id: string) => void;
  children: ReactNode;
  /** Barra fixa de salvar (some quando não há nada a salvar na página) */
  salvar?: { sujo: boolean; salvando: boolean; aoSalvar: () => void; rotulo?: string };
  /** Conteúdo ao lado do cartão (ex.: prévia) */
  lateral?: ReactNode;
}) {
  const i = passos && atual ? passos.findIndex((p) => p.id === atual.id) : -1;
  const curto = titulo.replace(/^Configurações\s+/, '');
  return (
    <div className={cx('cfg', salvar && 'cfg--com-rodape')}>
      <header className="cfg__cab">
        <h1>{titulo}</h1>
        <nav className="cfg__trilha" aria-label="Você está em">
          <Link to="/painel">Início</Link><ChevronRight size={12} />
          <Link to="/painel/config">Configurações</Link><ChevronRight size={12} />
          {atual && passos && passos.length > 1 ? <><span>{curto}</span><ChevronRight size={12} /><b>{atual.rotulo}</b></> : <b>{curto}</b>}
        </nav>
      </header>

      <div className={cx('cfg__corpo', !passos?.length && 'cfg__corpo--unico')}>
        {passos && passos.length > 0 && (
          <ol className="cfg__passos">
            {passos.map((p, n) => (
              <li key={p.id}>
                <button type="button" className={cx(p.id === atual?.id && 'ativo')} onClick={() => aoPasso?.(p.id)} aria-current={p.id === atual?.id ? 'step' : undefined}>
                  <span className="cfg__num">{n + 1}.</span>{p.rotulo}
                </button>
              </li>
            ))}
          </ol>
        )}
        <section className="cfg__cartao">
          {atual && (
            <header className="cfg__cartao-cab">
              <h2>{i + 1}. {atual.titulo ?? atual.rotulo}</h2>
              {atual.dica && <p>{atual.dica}</p>}
            </header>
          )}
          {children}
        </section>
        {lateral && <aside className="cfg__lateral">{lateral}</aside>}
      </div>

      {salvar && (
        <footer className="cfg__rodape">
          {salvar.sujo && <span className="cfg__aviso">Você tem alterações não salvas</span>}
          <button className="btn btn--primario btn--lg" disabled={!salvar.sujo || salvar.salvando} onClick={salvar.aoSalvar}>
            {salvar.salvando ? 'Salvando…' : salvar.rotulo ?? 'Salvar alterações'}
          </button>
        </footer>
      )}
    </div>
  );
}

/** Opção com chave liga/desliga num cartão tracejado (igual à tela do Anota AI). */
export function OpcaoChave({ titulo, dica, marcado, aoMudar, desativado }: {
  titulo: string; dica: string; marcado: boolean; aoMudar: (v: boolean) => void; desativado?: boolean;
}) {
  return (
    <div className={cx('cfg-opcao', marcado && 'ligada')}>
      <Switch marcado={marcado} aoMudar={aoMudar} desativado={desativado}>
        <span className="cfg-opcao__texto"><strong>{titulo}</strong><small>{dica}</small></span>
      </Switch>
    </div>
  );
}

/** Campo com texto de ajuda embaixo (como no Anota AI). */
export function CampoAjuda({ rotulo, ajuda, children }: { rotulo: string; ajuda?: ReactNode; children: ReactNode }) {
  return (
    <label className="campo cfg-campo">
      <span>{rotulo}</span>
      {children}
      {ajuda && <small className="cfg-campo__ajuda">{ajuda}</small>}
    </label>
  );
}

/** Igualdade simples para saber se o formulário mudou. */
export const mudou = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
