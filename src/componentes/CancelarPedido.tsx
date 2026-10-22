import { useEffect, useState, type ReactNode } from 'react';
import { BellRing, Check } from 'lucide-react';
import { Modal } from './Modal';
import type { useToast } from './Toast';
import { msgErro, supabase } from '../lib/supabase';
import type { Pedido } from '../lib/tipos';
import { MOTIVOS_CANCELAMENTO, fraseCancelamento } from '../lib/cancelamento';
import { brl, cx } from '../lib/util';

/** itens nulo = pedido inteiro */
interface Escolha { itens: string[] | null; motivo: string }
interface Pergunta { pedido: Pedido; responder: (e: Escolha | null) => void; inicial?: string }

let abrir: ((p: Pergunta) => void) | null = null;

function escolherCancelamento(pedido: Pedido, inicial?: string): Promise<Escolha | null> {
  if (!abrir) return Promise.resolve(window.confirm(`Cancelar o pedido #${pedido.numero}?`) ? { itens: inicial ? [inicial] : null, motivo: '' } : null);
  return new Promise((responder) => abrir!({ pedido, responder, inicial }));
}

/** Pergunta o que cancelar e por quê, cancela no servidor e atualiza a tela. A mesa recebe o aviso. */
export async function cancelarComMotivo(
  p: Pedido,
  atualizar: (id: string, m: Partial<Pedido>) => void,
  toast: ReturnType<typeof useToast>,
  /** Já abre com este item marcado (botão de lixeira no item) */
  itemInicial?: string,
) {
  const e = await escolherCancelamento(p, itemInicial);
  if (!e) return;
  const { data, error } = await supabase.rpc('pedido_cancelar', { p_pedido: p.id, p_itens: e.itens, p_motivo: e.motivo });
  if (error) return toast(msgErro(error), 'erro');
  const r = data as { pedido_cancelado: boolean; total: number };
  const aviso = (p.tipo ?? 'mesa') === 'mesa' ? ' A mesa foi avisada.' : ' O cliente vê o motivo no acompanhamento.';
  if (r.pedido_cancelado) {
    atualizar(p.id, { status: 'cancelado', atualizado_em: new Date().toISOString() });
    toast(`Pedido #${p.numero} cancelado.${aviso}`, 'ok');
  } else {
    const fora = new Set(e.itens ?? []);
    atualizar(p.id, { total: Number(r.total), pedido_itens: p.pedido_itens.filter((i) => !fora.has(i.id)) });
    toast(`${fora.size === 1 ? 'Item cancelado' : 'Itens cancelados'} no pedido #${p.numero}.${aviso}`, 'ok');
  }
}

export function ProvedorCancelar({ children }: { children: ReactNode }) {
  const [pergunta, setPergunta] = useState<Pergunta | null>(null);
  useEffect(() => {
    abrir = setPergunta;
    return () => { abrir = null; };
  }, []);
  return (
    <>
      {children}
      {pergunta && <ModalCancelar key={pergunta.pedido.id} {...pergunta} fechar={() => setPergunta(null)} />}
    </>
  );
}

function ModalCancelar({ pedido: p, responder, fechar, inicial }: Pergunta & { fechar: () => void }) {
  const itens = p.pedido_itens;
  const [sel, setSel] = useState<Set<string>>(() => new Set(inicial ? [inicial] : itens.length === 1 ? [itens[0].id] : []));
  const [motivo, setMotivo] = useState('');
  const [outro, setOutro] = useState('');
  const todos = itens.length === 0 || sel.size === itens.length;
  const texto = motivo === 'Outro' ? outro.trim() : motivo;
  const parcialPago = !!p.pago_em && !todos;
  const pronto = (todos || sel.size > 0) && !!texto && !parcialPago;
  const ehMesa = (p.tipo ?? 'mesa') === 'mesa';
  const primeiro = itens.find((i) => sel.has(i.id))?.nome ?? itens[0]?.nome ?? 'pedido';

  const fim = (e: Escolha | null) => { responder(e); fechar(); };
  const alternar = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <Modal
      aberto
      aoFechar={() => fim(null)}
      largura={520}
      titulo={`Cancelar no pedido #${p.numero}`}
      classe="cancelar-modal"
      rodape={
        <>
          <button className="btn btn--contorno" onClick={() => fim(null)}>Voltar</button>
          <button className="btn btn--perigo-cheio" disabled={!pronto} onClick={() => fim({ itens: todos ? null : [...sel], motivo: texto })}>
            {todos ? 'Cancelar pedido inteiro' : sel.size ? `Cancelar ${sel.size} ${sel.size === 1 ? 'item' : 'itens'}` : 'Escolha o item'}
          </button>
        </>
      }
    >
      <div className="cancelar">
        {itens.length > 0 && (
          <section className="cancelar__bloco">
            <div className="cancelar__cab">
              <h3>O que vai cancelar?</h3>
              {itens.length > 1 && (
                <button type="button" className="btn btn--fantasma btn--sm" onClick={() => setSel(todos ? new Set() : new Set(itens.map((i) => i.id)))}>
                  {todos ? 'Desmarcar todos' : 'Marcar todos'}
                </button>
              )}
            </div>
            <ul className="cancelar__itens">
              {itens.map((i) => {
                const on = sel.has(i.id);
                return (
                  <li key={i.id}>
                    <button type="button" className={cx('cancelar__item', on && 'ativo')} onClick={() => alternar(i.id)} aria-pressed={on}>
                      <span className="cancelar__check">{on && <Check size={14} strokeWidth={3} />}</span>
                      <span className="cancelar__nome"><span><b>{i.qtd}×</b> {i.nome}</span>{i.complementos && <small>{i.complementos}</small>}</span>
                      <span className="cancelar__valor">{brl(i.qtd * Number(i.preco_unit))}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {parcialPago && <p className="cancelar__alerta">Esta conta já foi paga: só dá para cancelar o pedido inteiro.</p>}
          </section>
        )}

        <section className="cancelar__bloco">
          <h3>Por quê?</h3>
          <div className="cancelar__motivos">
            {[...MOTIVOS_CANCELAMENTO.map((m) => m.rotulo), 'Outro'].map((m) => (
              <button key={m} type="button" className={cx('cancelar__motivo', motivo === m && 'ativo')} onClick={() => setMotivo(m)}>{m}</button>
            ))}
          </div>
          {motivo === 'Outro' && (
            <input className="input" autoFocus maxLength={140} value={outro} onChange={(e) => setOutro(e.target.value)} placeholder="Ex.: o forno parou de funcionar" />
          )}
        </section>

        {texto && (
          <p className="cancelar__previa">
            <BellRing size={16} />
            <span>
              {ehMesa ? 'A mesa recebe na tela:' : 'O cliente vê no acompanhamento:'}{' '}
              <b>“{fraseCancelamento(todos && itens.length > 1 ? 'pedido' : primeiro, motivo === 'Outro' ? texto : motivo).replace('O item pedido', 'O pedido')}”</b>
            </span>
          </p>
        )}
      </div>
    </Modal>
  );
}
