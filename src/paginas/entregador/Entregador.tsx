import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  BellOff, Bike, ChefHat, ChevronDown, Clock, Gift, HandCoins, History, LogOut, MapPin, MessageCircle, Navigation, Package, Phone, RefreshCw, Volume2, VolumeX, Wallet,
} from 'lucide-react';
import { Carregando } from '../../componentes/Carregando';
import { Avatar, ModalPerfil } from '../../componentes/Perfil';
import { useToast } from '../../componentes/Toast';
import { confirmar } from '../../componentes/Confirmar';
import { ativarPush, estadoPush, type EstadoPush } from '../../lib/push';
import { useSessao } from '../../lib/sessao';
import { definirSom, somLigado, tocarAlerta } from '../../lib/som';
import { msgErro, supabase } from '../../lib/supabase';
import type { Pedido } from '../../lib/tipos';
import { brl, cx, hora, tempoDesde, useAgora } from '../../lib/util';
import { usePedidosAoVivo } from '../../lib/usePedidosAoVivo';
import { aplicarAtualizacao, useNovaVersao } from '../../lib/versao';
import { useAparencia } from '../../lib/aparencia';
import '../../estilos/painel.css';
import '../../estilos/garcom.css';
import '../../estilos/entregador.css';

type Aba = 'entregas' | 'minhas' | 'ganhos';
const FORMA: Record<string, string> = { dinheiro: 'em dinheiro', pix: 'no Pix', credito: 'no cartão de crédito', debito: 'no cartão de débito' };

const saudacao = (agora: number) => { const h = new Date(agora).getHours(); return h < 5 ? 'Boa noite' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };
const ativa = (p: Pedido) => p.tipo === 'delivery' && p.status !== 'cancelado' && p.status !== 'entregue' && !p.entregue_em;

export default function Entregador() {
  const s = useSessao();
  const toast = useToast();
  const r = s.restaurante!;
  const eu = s.usuario?.id ?? '';
  const agora = useAgora(20000);
  const [aba, setAba] = useState<Aba>('entregas');
  const [som, setSom] = useState(somLigado());
  const [push, setPush] = useState<EstadoPush | null>(null);
  const [perfil, setPerfil] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const novaVersao = useNovaVersao(30000);
  useAparencia('garcom', true);

  const vivo = usePedidosAoVivo(r.id, {
    aoNovoPedido: (p) => { if (p.tipo === 'delivery') tocarAlerta('pedido'); },
    aoPedidoPronto: (p) => {
      if (p.tipo !== 'delivery' || (p.entregador_id && p.entregador_id !== eu)) return;
      tocarAlerta('pronto');
      toast(`Entrega #${p.numero} pronta para sair · ${p.endereco?.bairro ?? ''}`, 'ok');
    },
  });
  useEffect(() => { void estadoPush().then(setPush); }, []);

  const entregas = vivo.pedidos.filter(ativa);
  const livres = entregas.filter((p) => !p.entregador_id).sort(ordenar);
  const minhas = entregas.filter((p) => p.entregador_id === eu).sort(ordenar);
  const prontasLivres = livres.filter((p) => p.status === 'pronto').length;

  async function acao(p: Pedido, rpc: 'entrega_pegar' | 'entrega_saiu' | 'entrega_concluir' | 'entrega_largar', ok: string) {
    if (rpc === 'entrega_concluir' && !(await confirmar(`Confirmar que o pedido #${p.numero} foi entregue para ${p.cliente_nome ?? 'o cliente'}?`, { sim: 'Entreguei' }))) return;
    if (rpc === 'entrega_largar' && !(await confirmar(`Largar a entrega #${p.numero}? Ela volta para os outros entregadores.`, { sim: 'Largar', perigo: true }))) return;
    setOcupado(p.id);
    const { error } = await supabase.rpc(rpc, { p_pedido: p.id });
    setOcupado(null);
    if (error) { toast(msgErro(error), 'erro'); void vivo.recarregar(); return; }
    toast(ok, 'ok');
    void vivo.recarregar();
    if (rpc === 'entrega_pegar') setAba('minhas');
  }

  async function ativarAvisos() {
    try {
      await ativarPush(r.id, 'entregador');
      toast('Pronto! O celular avisa quando tiver entrega, mesmo bloqueado.', 'ok');
    } catch (e) {
      toast(msgErro(e), 'erro');
    }
    setPush(await estadoPush());
  }

  const primeiroNome = (s.nome || 'Entregador').trim().split(/\s+/)[0];
  const abas: { id: Aba; rotulo: string; icone: ReactNode; qtd?: number; alerta?: boolean }[] = [
    { id: 'entregas', rotulo: 'Entregas', icone: <Package size={22} />, qtd: livres.length, alerta: prontasLivres > 0 },
    { id: 'minhas', rotulo: 'Comigo', icone: <Bike size={22} />, qtd: minhas.length, alerta: true },
    { id: 'ganhos', rotulo: 'Corridas', icone: <HandCoins size={22} /> },
  ];

  return (
    <div className="garcom gapp eapp" style={{ '--acento': r.cor } as CSSProperties}>
      <header className="gtopo">
        <button className="gtopo__perfil" onClick={() => setPerfil(true)} aria-label="Meu perfil" title="Meu perfil">
          <Avatar nome={s.nome || 'Entregador'} foto={s.foto} tamanho={42} />
          <i className={cx('gtopo__vivo', vivo.conectado && 'on')} />
        </button>
        <div className="gtopo__txt">
          <strong>{saudacao(agora)}, {primeiroNome}</strong>
          <span className={cx('gtopo__status', vivo.conectado && 'on')}>{vivo.conectado ? 'Ao vivo' : 'Reconectando…'} · {r.nome}</span>
        </div>
        <button className="gtopo__btn" onClick={() => { const v = !som; setSom(v); definirSom(v); if (v) tocarAlerta('pronto'); }} aria-label={som ? 'Desligar som' : 'Ligar som'}>
          {som ? <Volume2 size={20} /> : <VolumeX size={20} />}
        </button>
        <button className="gtopo__btn" onClick={() => void confirmar('Sair do app de entregas?', { sim: 'Sair' }).then((ok) => { if (ok) void s.sair(); })} aria-label="Sair"><LogOut size={19} /></button>
      </header>
      {perfil && <ModalPerfil aoFechar={() => setPerfil(false)} />}

      <main className="gapp__conteudo">
        {novaVersao && (
          <div className="gaviso gaviso--info">
            <span className="gaviso__icone"><RefreshCw size={18} /></span>
            <div className="gaviso__txt"><b>App atualizado</b><small>Toque para carregar a versão nova</small></div>
            <button className="gaviso__btn" onClick={aplicarAtualizacao}>Atualizar</button>
          </div>
        )}
        {push && (push === 'inativo' || push === 'bloqueado' || push === 'precisa-instalar') && (
          <div className="gaviso">
            <span className="gaviso__icone"><BellOff size={18} /></span>
            <div className="gaviso__txt">
              <b>Ative os avisos</b>
              <small>{push === 'precisa-instalar' ? 'No iPhone: Compartilhar › Adicionar à Tela de Início e abra pelo ícone'
                : push === 'bloqueado' ? 'Bloqueados: libere em Permissões › Notificações' : 'Saiba na hora quando tiver entrega pronta'}</small>
            </div>
            {push === 'inativo' && <button className="gaviso__btn" onClick={() => void ativarAvisos()}>Ativar</button>}
          </div>
        )}

        {vivo.carregando ? <Carregando /> : aba === 'ganhos' ? (
          <Ganhos restauranteId={r.id} eu={eu} chave={vivo.pedidos.filter((p) => p.entregador_id === eu && p.entregue_em).length} />
        ) : (
          <>
            <div className="gsecao">
              <h2>{aba === 'entregas' ? 'Entregas para pegar' : 'Minhas entregas'}</h2>
              {(aba === 'entregas' ? livres : minhas).length > 0 && <span className="gsecao__qtd">{(aba === 'entregas' ? livres : minhas).length}</span>}
            </div>
            {(aba === 'entregas' ? livres : minhas).length === 0 ? (
              <div className="gvazio">
                <span className="gvazio__icone">{aba === 'entregas' ? <Package size={34} /> : <Bike size={34} />}</span>
                <strong>{aba === 'entregas' ? 'Nenhuma entrega esperando' : 'Você não está com nenhuma entrega'}</strong>
                <p>{aba === 'entregas' ? 'Quando chegar um pedido de entrega ele aparece aqui, e o celular avisa quando ficar pronto.' : 'Pegue uma entrega na aba Entregas.'}</p>
              </div>
            ) : (
              <div className="ent-lista">
                {(aba === 'entregas' ? livres : minhas).map((p) => (
                  <CartaoEntrega key={p.id} p={p} agora={agora} cidade={r.endereco_info?.cidade ?? ''} ocupado={ocupado === p.id}
                    acoes={aba === 'entregas' ? (
                      <button className="btn btn--primario btn--lg btn--bloco" disabled={ocupado === p.id} onClick={() => void acao(p, 'entrega_pegar', `Entrega #${p.numero} é sua!`)}>
                        <Bike size={19} /> Pegar esta entrega
                      </button>
                    ) : !p.saiu_em ? (
                      <div className="ent-acoes">
                        <button className="btn btn--contorno" disabled={ocupado === p.id} onClick={() => void acao(p, 'entrega_largar', `Entrega #${p.numero} liberada.`)}>Largar</button>
                        <button className="btn btn--primario btn--lg" disabled={ocupado === p.id} onClick={() => void acao(p, 'entrega_saiu', `Boa entrega! #${p.numero} saiu.`)}>
                          <Navigation size={18} /> Saí para entregar
                        </button>
                      </div>
                    ) : (
                      <button className="btn btn--sucesso btn--lg btn--bloco" disabled={ocupado === p.id} onClick={() => void acao(p, 'entrega_concluir', `Entrega #${p.numero} concluída. Corrida de ${brl(Number(p.taxa_entregador ?? 0))} somada!`)}>
                        <HandCoins size={19} /> Entreguei
                      </button>
                    )} />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      <nav className="gnav eapp__nav" aria-label="Seções do app">
        {abas.map((a) => (
          <button key={a.id} className={cx('gnav__item', aba === a.id && 'ativo')} aria-current={aba === a.id ? 'page' : undefined} onClick={() => { setAba(a.id); window.scrollTo({ top: 0 }); }}>
            <span className="gnav__icone">{a.icone}{!!a.qtd && <b className={cx(a.alerta && 'alerta')}>{a.qtd > 99 ? '99+' : a.qtd}</b>}</span>
            <span className="gnav__rotulo">{a.rotulo}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Prontos primeiro, depois os mais antigos */
function ordenar(a: Pedido, b: Pedido) {
  const peso = (p: Pedido) => (p.saiu_em ? 0 : p.status === 'pronto' ? 1 : 2);
  return peso(a) - peso(b) || a.criado_em.localeCompare(b.criado_em);
}

function rotaMapa(p: Pedido, cidade: string) {
  const e = p.endereco;
  if (!e) return null;
  if (e.lat != null && e.lng != null) return { google: `https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lng}`, waze: `https://waze.com/ul?ll=${e.lat},${e.lng}&navigate=yes` };
  const texto = encodeURIComponent([`${e.rua}, ${e.numero}`, e.bairro, cidade].filter(Boolean).join(' - '));
  return { google: `https://www.google.com/maps/dir/?api=1&destination=${texto}`, waze: `https://waze.com/ul?q=${texto}&navigate=yes` };
}

function CartaoEntrega({ p, agora, cidade, acoes, ocupado }: { p: Pedido; agora: number; cidade: string; acoes: ReactNode; ocupado: boolean }) {
  const [verItens, setVerItens] = useState(false);
  const e = p.endereco;
  const tel = (p.cliente_telefone ?? '').replace(/\D/g, '');
  const rota = rotaMapa(p, cidade);
  const total = Number(p.total);
  const troco = p.forma_pagamento === 'dinheiro' && p.troco_para && Number(p.troco_para) > total ? Number(p.troco_para) - total : 0;
  const etapa = p.saiu_em ? { classe: 'rota', texto: `Em rota desde ${hora(p.saiu_em)}`, icone: <Navigation size={14} /> }
    : p.status === 'pronto' ? { classe: 'pronto', texto: 'Pronto para sair', icone: <Package size={14} /> }
      : { classe: 'preparo', texto: p.status === 'novo' ? 'Pedido novo' : 'Em preparo', icone: <ChefHat size={14} /> };
  const qtdItens = p.pedido_itens.reduce((n, i) => n + i.qtd, 0);

  return (
    <article className={cx('ent-card', `ent-card--${etapa.classe}`, ocupado && 'ocupado')}>
      <header className="ent-card__topo">
        <strong>#{p.numero}</strong>
        <span className={cx('ent-etapa', `ent-etapa--${etapa.classe}`)}>{etapa.icone} {etapa.texto}</span>
        <small><Clock size={12} /> {tempoDesde(p.criado_em, agora)}</small>
      </header>

      <div className="ent-card__cliente">
        <b>{p.cliente_nome || 'Cliente'}</b>
        {e ? (
          <p className="ent-end">
            <MapPin size={16} />
            <span>
              {e.rua}, {e.numero}{e.complemento ? ` · ${e.complemento}` : ''}
              <strong>{e.bairro}{e.distancia_km != null ? ` · ${String(e.distancia_km).replace('.', ',')} km` : ''}</strong>
              {e.referencia && <em>Ref.: {e.referencia}</em>}
            </span>
          </p>
        ) : <p className="ent-end"><MapPin size={16} /> <span>Endereço não informado</span></p>}
      </div>

      <div className="ent-botoes">
        {rota && <a className="ent-botao ent-botao--mapa" href={rota.google} target="_blank" rel="noopener"><Navigation size={17} /> Google Maps</a>}
        {rota && <a className="ent-botao" href={rota.waze} target="_blank" rel="noopener"><MapPin size={17} /> Waze</a>}
        {tel && <a className="ent-botao ent-botao--whats" href={`https://wa.me/${tel.length <= 11 ? `55${tel}` : tel}`} target="_blank" rel="noopener"><MessageCircle size={17} /> WhatsApp</a>}
        {tel && <a className="ent-botao" href={`tel:${tel}`}><Phone size={17} /> Ligar</a>}
      </div>

      <div className="ent-valores">
        <div className={cx('ent-cobrar', p.pago_em && 'pago')}>
          <Wallet size={18} />
          {p.pago_em ? (
            <span><b>Já está pago</b><small>Não cobrar nada do cliente</small></span>
          ) : (
            <span>
              <b>Cobrar {brl(total)}</b>
              <small>{p.forma_pagamento ? FORMA[p.forma_pagamento] : 'combinar com o cliente'}{p.forma_pagamento === 'credito' || p.forma_pagamento === 'debito' ? ' · leve a maquininha' : ''}</small>
              {troco > 0 && <small className="ent-troco">Levar troco: <b>{brl(troco)}</b> (cliente paga com {brl(Number(p.troco_para))})</small>}
            </span>
          )}
        </div>
        <div className="ent-corrida">
          <small>Sua corrida</small>
          <strong>{brl(Number(p.taxa_entregador ?? 0))}</strong>
        </div>
      </div>
      {p.frete_gratis && (
        <p className="ent-frete"><Gift size={16} /> <span><b>Frete grátis para o cliente</b> · não cobre a entrega dele. Sua corrida continua valendo.</span></p>
      )}

      <button type="button" className="ent-itens-btn" onClick={() => setVerItens((v) => !v)} aria-expanded={verItens}>
        {qtdItens} {qtdItens === 1 ? 'item' : 'itens'} no pedido <ChevronDown size={16} className={cx(verItens && 'virado')} />
      </button>
      {verItens && (
        <ul className="ent-itens">
          {p.pedido_itens.map((i) => <li key={i.id}><b>{i.qtd}×</b> <span>{i.nome}{i.complementos && <small>{i.complementos}</small>}</span></li>)}
          {p.observacao && <li className="ent-itens__obs">Obs.: {p.observacao}</li>}
        </ul>
      )}

      <div className="ent-card__acao">{acoes}</div>
    </article>
  );
}

type Feita = Pick<Pedido, 'id' | 'numero' | 'entregue_em' | 'taxa_entregador' | 'frete_gratis' | 'endereco' | 'entregador_pago_em'>;

/** Corridas do entregador: hoje, semana, a receber e o histórico (para conferir com a loja) */
function Ganhos({ restauranteId, eu, chave }: { restauranteId: string; eu: string; chave: number }) {
  const [lista, setLista] = useState<Feita[] | null>(null);
  const carregar = useCallback(async () => {
    const desde = new Date(Date.now() - 31 * 86400e3).toISOString();
    const { data } = await supabase.from('pedidos')
      .select('id, numero, entregue_em, taxa_entregador, frete_gratis, endereco, entregador_pago_em')
      .eq('restaurante_id', restauranteId).eq('entregador_id', eu).eq('status', 'entregue')
      .gte('entregue_em', desde).order('entregue_em', { ascending: false });
    setLista((data ?? []) as Feita[]);
  }, [restauranteId, eu]);
  useEffect(() => { void carregar(); }, [carregar, chave]);

  const n = useMemo(() => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const semana = new Date(hoje); semana.setDate(hoje.getDate() - ((hoje.getDay() + 6) % 7));
    const r = { hoje: 0, hojeQtd: 0, semana: 0, semanaQtd: 0, receber: 0, receberQtd: 0 };
    for (const c of lista ?? []) {
      const v = Number(c.taxa_entregador ?? 0);
      const t = new Date(c.entregue_em ?? 0).getTime();
      if (t >= hoje.getTime()) { r.hoje += v; r.hojeQtd++; }
      if (t >= semana.getTime()) { r.semana += v; r.semanaQtd++; }
      if (!c.entregador_pago_em) { r.receber += v; r.receberQtd++; }
    }
    return r;
  }, [lista]);

  if (!lista) return <Carregando />;
  const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return (
    <>
      <div className="gsecao"><h2>Minhas corridas</h2></div>
      <div className="ent-ganhos">
        <div className="ent-ganho ent-ganho--destaque">
          <small>A receber da loja</small>
          <strong>{brl(n.receber)}</strong>
          <span>{n.receberQtd === 0 ? 'Tudo acertado com a loja' : n.receberQtd === 1 ? '1 corrida ainda não acertada' : `${n.receberQtd} corridas ainda não acertadas`}</span>
        </div>
        <div className="ent-ganho"><small>Hoje</small><strong>{brl(n.hoje)}</strong><span>{n.hojeQtd} {n.hojeQtd === 1 ? 'entrega' : 'entregas'}</span></div>
        <div className="ent-ganho"><small>Esta semana</small><strong>{brl(n.semana)}</strong><span>{n.semanaQtd} {n.semanaQtd === 1 ? 'entrega' : 'entregas'}</span></div>
      </div>
      <div className="gsecao"><h2><History size={18} /> Últimos 30 dias</h2></div>
      {lista.length === 0 ? (
        <div className="gvazio"><span className="gvazio__icone"><HandCoins size={34} /></span><strong>Nenhuma corrida ainda</strong><p>Cada entrega concluída aparece aqui com o valor da corrida.</p></div>
      ) : (
        <ul className="ent-historico">
          {lista.map((c) => (
            <li key={c.id}>
              <div>
                <b>#{c.numero} · {c.endereco?.bairro ?? 'Entrega'}</b>
                <small>{c.entregue_em ? `${dia(c.entregue_em)} às ${hora(c.entregue_em)}` : ''}{c.frete_gratis ? ' · frete grátis p/ cliente' : ''}</small>
              </div>
              <span className={cx('ent-historico__valor', c.entregador_pago_em && 'pago')}>
                {brl(Number(c.taxa_entregador ?? 0))}
                <small>{c.entregador_pago_em ? 'Recebido' : 'A receber'}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
