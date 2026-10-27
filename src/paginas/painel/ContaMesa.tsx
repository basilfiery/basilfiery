import { useEffect, useRef, useState } from 'react';
import { Banknote, Check, CircleCheck, CreditCard, Printer, Receipt, Trash2, Wallet, X } from 'lucide-react';
import { IconeForma, IconePix } from '../../componentes/Pagamento';
import { cancelarComMotivo } from '../../componentes/CancelarPedido';
import { useToast } from '../../componentes/Toast';
import { imprimirConta } from '../../lib/impressao';
import { msgErro, supabase } from '../../lib/supabase';
import type { FormaPagamento, Mesa, Pedido } from '../../lib/tipos';
import { brl, cx, hora, lerPreco, mascaraPreco, podeCaixa, precoParaTexto, rotuloForma } from '../../lib/util';
import { usePainel } from './Painel';

/* =====================================================================
   Conta da mesa (tela de lançar na mesa): consumo, desconto/acréscimo e
   pagamento dividido: cada pessoa paga um valor, no dinheiro, cartão ou Pix.
   Os pagamentos lançados ficam guardados nesta aba até fechar a conta.
   ===================================================================== */

type Escolha = 'dinheiro' | 'cartao' | 'pix';
interface Parte { id: string; forma: FormaPagamento; valor: number; recebido?: number } // centavos
interface Rascunho { partes: Parte[]; desconto: string; acrescimo: string }

const cent = (v: number) => Math.round(v * 100);
const txt = (c: number) => precoParaTexto(c / 100);
const ORDINAL = ['1ª', '2ª', '3ª', '4ª', '5ª', '6ª', '7ª', '8ª', '9ª', '10ª'];

/** "10%" vira porcentagem do subtotal; "5,00" vira R$ 5,00 (em centavos). */
function lerAjuste(t: string, subtotal: number) {
  const s = t.trim();
  if (!s) return 0;
  if (s.endsWith('%')) {
    const p = Number(s.slice(0, -1).replace(',', '.'));
    return Number.isFinite(p) && p >= 0 ? Math.round(subtotal * p / 100) : NaN;
  }
  const v = lerPreco(s);
  return Number.isFinite(v) && v >= 0 ? cent(v) : NaN;
}

const chave = (mesaId: string) => `bf:conta:${mesaId}`;
function lerRascunho(mesaId: string): Rascunho {
  try {
    const r = JSON.parse(sessionStorage.getItem(chave(mesaId)) ?? 'null') as Rascunho | null;
    if (r && Array.isArray(r.partes)) return r;
  } catch { /* sem armazenamento */ }
  return { partes: [], desconto: '', acrescimo: '' };
}

export function ContaMesa({ mesa, pedidos, aoMudar, aoFechada }: { mesa: Mesa; pedidos: Pedido[]; aoMudar: () => void; aoFechada: () => void }) {
  const { restaurante, papel, caixa, abrirCaixa, recarregarCaixa, atualizarPedido } = usePainel();
  const toast = useToast();
  const [rasc, setRasc] = useState<Rascunho>(() => lerRascunho(mesa.id));
  const [ajuste, setAjuste] = useState<'desconto' | 'acrescimo' | null>(null);
  const [escolha, setEscolha] = useState<Escolha | null>(null);
  const [cartao, setCartao] = useState<'credito' | 'debito'>('credito');
  const [valor, setValor] = useState('');
  const [recebido, setRecebido] = useState('');
  const [fechando, setFechando] = useState(false);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const valorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { sessionStorage.setItem(chave(mesa.id), JSON.stringify(rasc)); } catch { /* sem armazenamento */ }
  }, [mesa.id, rasc]);

  // Tela baixa: abre já mostrando o fechamento (o consumo fica logo acima, rolando)
  const rolagem = useRef<HTMLDivElement>(null);
  const rolou = useRef(false);
  const temConsumo = pedidos.length > 0;
  useEffect(() => {
    const el = rolagem.current;
    const fech = el?.querySelector<HTMLElement>('.cm__fechamento');
    if (rolou.current || !el || !fech) return;
    rolou.current = true;
    if (el.scrollHeight > el.clientHeight) el.scrollTop = Math.max(0, fech.offsetTop - el.offsetTop - 60);
  }, [temConsumo]);
  useEffect(() => {
    if (escolha) rolagem.current?.querySelector('.cm-form')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [escolha]);

  const subtotal = pedidos.reduce((s, p) => s + cent(Number(p.total)), 0);
  const desc = lerAjuste(rasc.desconto, subtotal);
  const acr = lerAjuste(rasc.acrescimo, subtotal);
  const descOk = Number.isFinite(desc) && desc <= subtotal;
  const acrOk = Number.isFinite(acr) && acr <= Math.max(subtotal, 10000);
  const devido = subtotal - (descOk ? desc : 0) + (acrOk ? acr : 0);
  const pago = rasc.partes.reduce((s, p) => s + p.valor, 0);
  const falta = devido - pago;
  const pode = podeCaixa(papel);
  const pronta = descOk && acrOk && falta === 0 && (devido === 0 || rasc.partes.length > 0);

  const mudar = (m: Partial<Rascunho>) => setRasc((r) => ({ ...r, ...m }));
  const forma: FormaPagamento | null = escolha === 'cartao' ? cartao : escolha;
  const valorC = valor.trim() ? cent(lerPreco(valor)) : NaN;
  const recebidoC = recebido.trim() ? cent(lerPreco(recebido)) : NaN;
  const troco = escolha === 'dinheiro' && Number.isFinite(recebidoC) && Number.isFinite(valorC) ? recebidoC - valorC : null;
  const erroValor =
    !Number.isFinite(valorC) || valorC <= 0 ? 'Digite o valor pago'
      : valorC > falta ? `Maior que o que falta (${brl(falta / 100)})`
        : troco !== null && troco < 0 ? 'Valor recebido menor que o pago'
          : '';

  function escolher(e: Escolha) {
    setEscolha(e);
    setValor(txt(Math.max(falta, 0)));
    setRecebido('');
    requestAnimationFrame(() => valorRef.current?.select());
  }

  function lancar() {
    if (!forma || erroValor) return;
    const parte: Parte = { id: crypto.randomUUID(), forma, valor: valorC, ...(escolha === 'dinheiro' && Number.isFinite(recebidoC) ? { recebido: recebidoC } : {}) };
    mudar({ partes: [...rasc.partes, parte] });
    setEscolha(null);
    if (valorC === falta) requestAnimationFrame(() => fecharRef.current?.focus());
  }

  async function fecharConta() {
    if (!pronta || fechando) return;
    setFechando(true);
    const { error } = await supabase.rpc('mesa_receber_conta', {
      p_mesa: mesa.id,
      p_pagamentos: rasc.partes.map((p) => ({ forma: p.forma, valor: p.valor / 100 })),
      p_desconto: (descOk ? desc : 0) / 100,
      p_acrescimo: (acrOk ? acr : 0) / 100,
    });
    setFechando(false);
    if (error) return toast(msgErro(error), 'erro');
    try { sessionStorage.removeItem(chave(mesa.id)); } catch { /* sem armazenamento */ }
    const formas = [...new Set(rasc.partes.map((p) => rotuloForma(p.forma)))];
    toast(`${mesa.nome} liberada. ${brl(devido / 100)} recebido${formas.length ? ` (${formas.join(' + ')})` : ''}.`, 'ok');
    recarregarCaixa();
    aoMudar();
    aoFechada();
  }

  // Divide a conta em partes iguais (o último paga o que sobrar dos centavos)
  const divisoes = [...new Set([2, 3, 4, ...(mesa.pessoas && mesa.pessoas > 4 ? [mesa.pessoas] : [])])];

  if (!pedidos.length) {
    return (
      <div className="cm">
        <div className="pdv-pedido__vazio cm__vazio"><Receipt size={34} strokeWidth={1.5} /><p>Nenhum consumo nesta mesa.<br />Lance os produtos na aba Novo pedido.</p></div>
      </div>
    );
  }

  return (
    <div className="cm">
      <div className="cm__rolagem" ref={rolagem}>
        <div className="cm__consumo">
          {pedidos.map((p) => (
            <section key={p.id} className="cm__pedido">
              <header><b>Pedido #{p.numero}</b><span>{hora(p.criado_em)}</span></header>
              <ul>
                {p.pedido_itens.map((i) => (
                  <li key={i.id}>
                    <span className="cm__qtd">{i.qtd}×</span>
                    <span className="cm__nome">{i.nome}{i.complementos && <small>{i.complementos}</small>}</span>
                    <span className="cm__preco">{brl(i.qtd * i.preco_unit)}</span>
                    <button type="button" className="cm__excluir" title="Excluir item" aria-label={`Excluir ${i.nome}`}
                      onClick={() => void cancelarComMotivo(p, (id, m) => { atualizarPedido(id, m); aoMudar(); }, toast, i.id)}>
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <button type="button" className="cm__imprimir" onClick={() => imprimirConta(mesa.nome, restaurante.nome, pedidos)}><Printer size={15} /> Imprimir conta</button>
        </div>

        <div className="cm__fechamento">
          <div className="cm-ajustes" role="group" aria-label="Ajustes da conta">
            <button type="button" className={cx(ajuste === 'desconto' && 'ativo', rasc.desconto && 'com-valor')} onClick={() => setAjuste(ajuste === 'desconto' ? null : 'desconto')} disabled={!pode}>Desconto</button>
            <button type="button" className={cx(ajuste === 'acrescimo' && 'ativo', rasc.acrescimo && 'com-valor')} onClick={() => setAjuste(ajuste === 'acrescimo' ? null : 'acrescimo')} disabled={!pode}>Acréscimo</button>
          </div>
          {ajuste && (
            <div className="cm-ajuste">
              <input
                className={cx('input', !(ajuste === 'desconto' ? descOk : acrOk) && 'input--erro')}
                value={ajuste === 'desconto' ? rasc.desconto : rasc.acrescimo}
                onChange={(e) => mudar(ajuste === 'desconto' ? { desconto: e.target.value } : { acrescimo: e.target.value })}
                placeholder={ajuste === 'desconto' ? 'Desconto em R$ ou %' : 'Acréscimo em R$ ou %'}
                inputMode="decimal" autoFocus aria-label={ajuste === 'desconto' ? 'Desconto' : 'Acréscimo'}
              />
              {(ajuste === 'desconto' ? ['5%', '10%'] : ['10%']).map((v) => (
                <button key={v} type="button" className="pdv-chip" onClick={() => mudar(ajuste === 'desconto' ? { desconto: v } : { acrescimo: v })}>
                  {ajuste === 'acrescimo' ? `${v} serviço` : v}
                </button>
              ))}
              {(ajuste === 'desconto' ? rasc.desconto : rasc.acrescimo) && (
                <button type="button" className="icone-btn cm-ajuste__limpar" onClick={() => mudar(ajuste === 'desconto' ? { desconto: '' } : { acrescimo: '' })} aria-label="Tirar"><X size={16} /></button>
              )}
            </div>
          )}

          <div className="cm-totais">
            <div><span>Subtotal</span><span>{brl(subtotal / 100)}</span></div>
            {descOk && desc > 0 && <div className="cm-totais__menos"><span>Desconto{rasc.desconto.trim().endsWith('%') ? ` (${rasc.desconto.trim()})` : ''}</span><span>− {brl(desc / 100)}</span></div>}
            {acrOk && acr > 0 && <div><span>Acréscimo{rasc.acrescimo.trim().endsWith('%') ? ` (${rasc.acrescimo.trim()})` : ''}</span><span>+ {brl(acr / 100)}</span></div>}
            {!descOk && <p className="cm-erro">Desconto inválido ou maior que a conta.</p>}
            {!acrOk && <p className="cm-erro">Acréscimo inválido.</p>}
            <div className="cm-totais__total"><span>Valor total</span><strong>{brl(devido / 100)}</strong></div>
          </div>

          {rasc.partes.length > 0 && (
            <ul className="cm-partes" aria-label="Pagamentos lançados">
              {rasc.partes.map((p) => (
                <li key={p.id}>
                  <IconeForma forma={p.forma} tamanho={16} />
                  <span className="cm-partes__txt">
                    <b>{rotuloForma(p.forma)}</b>
                    {p.recebido != null && p.recebido > p.valor && <small>Troco de {brl((p.recebido - p.valor) / 100)}</small>}
                  </span>
                  <strong>{brl(p.valor / 100)}</strong>
                  <button type="button" className="cm__excluir" onClick={() => mudar({ partes: rasc.partes.filter((x) => x.id !== p.id) })} aria-label={`Tirar pagamento de ${brl(p.valor / 100)}`} title="Tirar este pagamento"><X size={15} /></button>
                </li>
              ))}
              <li className={cx('cm-partes__falta', falta === 0 && 'ok', falta < 0 && 'passou')}>
                {falta > 0 ? <><span>Falta pagar</span><strong>{brl(falta / 100)}</strong></>
                  : falta === 0 ? <><span><CircleCheck size={17} /> Conta paga</span><strong>{brl(pago / 100)}</strong></>
                    : <><span>Pagamentos passam do total</span><strong>{brl(-falta / 100)}</strong></>}
              </li>
            </ul>
          )}

          {!pode ? (
            <p className="cm-aviso">Só o caixa, o gerente ou o dono recebem a conta.</p>
          ) : caixa === null ? (
            <div className="cm-aviso cm-aviso--caixa">
              <Wallet size={18} />
              <span>O caixa está fechado. Abra o caixa para receber esta conta.</span>
              <button type="button" className="btn btn--primario btn--sm" onClick={abrirCaixa}>Abrir caixa</button>
            </div>
          ) : falta > 0 && descOk && acrOk && (
            <div className="cm-pagar">
              <h3>Escolha a {ORDINAL[rasc.partes.length] ?? 'próxima'} forma de pagamento:</h3>
              <div className="cm-formas" role="radiogroup" aria-label="Forma de pagamento">
                {([
                  ['dinheiro', 'Dinheiro', <Banknote key="d" size={19} />],
                  ['cartao', 'Cartão', <CreditCard key="c" size={19} />],
                  ['pix', 'Pix', <IconePix key="p" size={19} />],
                ] as const).map(([id, rotulo, icone]) => (
                  <button key={id} type="button" role="radio" aria-checked={escolha === id} className={cx('cm-forma', escolha === id && 'ativo')} onClick={() => (escolha === id ? setEscolha(null) : escolher(id))}>
                    {icone}<span>{rotulo}</span>
                  </button>
                ))}
              </div>

              {escolha && (
                <form className="cm-form" onSubmit={(e) => { e.preventDefault(); lancar(); }}>
                  {escolha === 'cartao' && (
                    <div className="cm-cartao" role="radiogroup" aria-label="Tipo de cartão">
                      {(['credito', 'debito'] as const).map((c) => (
                        <button key={c} type="button" role="radio" aria-checked={cartao === c} className={cx(cartao === c && 'ativo')} onClick={() => setCartao(c)}>
                          {cartao === c && <Check size={14} strokeWidth={3} />} {c === 'credito' ? 'Crédito' : 'Débito'}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="cm-campo">
                    <span>Valor pago {escolha === 'pix' ? 'no Pix' : escolha === 'cartao' ? 'no cartão' : 'em dinheiro'}:</span>
                    <span className="cm-campo__caixa">
                      <b>R$</b>
                      <input ref={valorRef} value={valor} onChange={(e) => setValor(mascaraPreco(e.target.value))} inputMode="decimal" placeholder="0,00" aria-invalid={!!erroValor} />
                    </span>
                  </label>
                  <div className="cm-dividir">
                    <span>Dividir por</span>
                    {divisoes.map((n) => {
                      const parte = Math.round(devido / n);
                      if (parte >= falta) return null; // o que falta já é menor que a parte: só "Tudo"
                      return (
                        <button key={n} type="button" className={cx('pdv-chip', valorC === parte && 'ativo')} onClick={() => setValor(txt(parte))} title={`${n} pessoas: ${brl(Math.round(devido / n) / 100)} cada`}>
                          {n}
                        </button>
                      );
                    })}
                    <button type="button" className={cx('pdv-chip', valorC === falta && 'ativo')} onClick={() => setValor(txt(falta))}>Tudo</button>
                  </div>
                  {escolha === 'dinheiro' && (
                    <label className="cm-campo">
                      <span>Troco para: <small>(opcional)</small></span>
                      <span className="cm-campo__caixa">
                        <b>R$</b>
                        <input value={recebido} onChange={(e) => setRecebido(mascaraPreco(e.target.value))} inputMode="decimal" placeholder="Ex.: 50,00" />
                      </span>
                      {troco !== null && <em className={cx('cm-troco', troco < 0 && 'falta')}>{troco < 0 ? `Faltam ${brl(-troco / 100)}` : `Troco: ${brl(troco / 100)}`}</em>}
                    </label>
                  )}
                  {erroValor && valor.trim() && <p className="cm-erro">{erroValor}</p>}
                  <div className="cm-form__acoes">
                    <button type="button" className="btn btn--contorno" onClick={() => setEscolha(null)}>Cancelar</button>
                    <button className="btn btn--primario" disabled={!!erroValor}>Lançar pagamento</button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>

      {pode && caixa !== null && (
        <div className="pdv-pedido__acao">
          <button ref={fecharRef} type="button" className={cx('btn btn--lg btn--bloco cm-fechar', pronta && 'pronta')} disabled={!pronta || fechando} onClick={() => void fecharConta()}>
            {fechando ? 'Fechando…' : pronta ? <><CircleCheck size={20} /> Fechar conta e liberar mesa</> : falta < 0 ? 'Tire o pagamento a mais' : `Falta receber ${brl(falta / 100)}`}
          </button>
        </div>
      )}
    </div>
  );
}
