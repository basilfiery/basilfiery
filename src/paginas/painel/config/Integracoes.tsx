import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plug, ShieldAlert, ShieldCheck } from 'lucide-react';
import { BotaoCopiar } from '../../../componentes/Link';
import { confirmar } from '../../../componentes/Confirmar';
import { useToast } from '../../../componentes/Toast';
import { SUPABASE_URL, msgErro, supabase } from '../../../lib/supabase';
import { quando } from '../../../lib/util';
import { usePainel } from '../Painel';
import { PaginaConfig } from './Layout';

interface Chave { id: string; final: string; criado_em: string; criado_por_nome: string | null; ultimo_uso: string | null }

const BASE_API = `${SUPABASE_URL}/functions/v1/api`;
const ROTAS: { metodo: 'GET' | 'POST'; caminho: string; descricao: string }[] = [
  { metodo: 'GET', caminho: '/loja', descricao: 'Dados da loja (nome, contato, delivery)' },
  { metodo: 'GET', caminho: '/cardapio', descricao: 'Categorias, produtos, preços e sabores' },
  { metodo: 'GET', caminho: '/pedidos?desde=2026-10-18T00:00:00Z', descricao: 'Pedidos desde a data (padrão: últimas 24 h)' },
  { metodo: 'GET', caminho: '/pedidos/{id}', descricao: 'Um pedido com os itens' },
  { metodo: 'POST', caminho: '/pedidos/{id}/status', descricao: 'Muda o status: preparando, pronto ou entregue' },
];

/** Campo somente leitura com botão de copiar (como no Anota AI). */
function CampoCopiavel({ rotulo, valor, mascarado }: { rotulo: string; valor: string; mascarado?: string }) {
  return (
    <div className="campo cfg-campo">
      <span>{rotulo}</span>
      <div className="cfg-copiavel">
        <code>{mascarado ?? valor}</code>
        {!mascarado && <BotaoCopiar texto={valor} rotulo="" classe="cfg-copiavel__btn" />}
      </div>
    </div>
  );
}

export default function Integracoes() {
  const { restaurante: r } = usePainel();
  const toast = useToast();
  const [chave, setChave] = useState<Chave | null | undefined>(undefined);
  const [nova, setNova] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('api_chaves').select('id, final, criado_em, criado_por_nome, ultimo_uso')
      .eq('restaurante_id', r.id).is('revogada_em', null).maybeSingle();
    setChave((data as Chave | null) ?? null);
  }, [r.id]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function gerar() {
    if (chave && !(await confirmar('A chave atual para de funcionar na hora. Os aplicativos conectados vão precisar da nova chave.', { titulo: 'Gerar nova chave?', sim: 'Gerar nova', perigo: true }))) return;
    setOcupado(true);
    const { data, error } = await supabase.rpc('api_chave_gerar', { p_rest: r.id });
    setOcupado(false);
    if (error) return toast(msgErro(error), 'erro');
    setNova(data as string);
    void carregar();
  }

  async function revogar() {
    if (!(await confirmar('Os aplicativos que usam esta chave perdem o acesso na hora.', { titulo: 'Desligar a chave?', sim: 'Desligar', perigo: true }))) return;
    const { error } = await supabase.rpc('api_chave_revogar', { p_rest: r.id });
    if (error) return toast(msgErro(error), 'erro');
    setNova('');
    toast('Chave desligada.', 'ok');
    void carregar();
  }

  const exemplo = `curl ${BASE_API}/pedidos \\\n  -H "x-api-key: ${nova || 'SUA_CHAVE'}"`;

  return (
    <PaginaConfig titulo="Integrações">
      <div className="cfg-bloco">
        <h2 className="cfg-bloco__titulo">Chave de integração com o BasilFiery</h2>
        <p className="cfg-bloco__dica">Para integrar o BasilFiery com outros aplicativos (ERP, nota fiscal, entregadores, robôs), use os dados abaixo.</p>
        <div className="cfg-linha">
          <CampoCopiavel rotulo="ID da loja" valor={r.id} />
          <CampoCopiavel rotulo="Código da loja" valor={r.codigo} />
        </div>

        {nova ? (
          <div className="cfg-chave-nova">
            <CampoCopiavel rotulo="Chave de integração (Token)" valor={nova} />
            <p className="cfg-alerta"><ShieldAlert size={16} /> <span><b>Copie e guarde agora.</b> Por segurança, a chave inteira só aparece desta vez.</span></p>
          </div>
        ) : chave ? (
          <CampoCopiavel rotulo="Chave de integração (Token)" valor="" mascarado={`bf_${'•'.repeat(28)}${chave.final}`} />
        ) : chave === null ? (
          <div className="cfg-sem-chave">
            <KeyRound size={22} />
            <span><b>Você ainda não tem uma chave.</b> Gere uma para conectar outros aplicativos.</span>
          </div>
        ) : null}

        {chave && (
          <p className="cfg-nota">
            <ShieldCheck size={14} /> Chave ativa · criada {quando(chave.criado_em)}{chave.criado_por_nome ? ` por ${chave.criado_por_nome}` : ''} · {chave.ultimo_uso ? `último uso ${quando(chave.ultimo_uso)}` : 'ainda não usada'}
          </p>
        )}
        <div className="acoes-linha">
          <button className="btn btn--primario" disabled={ocupado || chave === undefined} onClick={() => void gerar()}><KeyRound size={17} /> {chave ? 'Gerar nova chave' : 'Gerar chave'}</button>
          {chave && <button className="btn btn--fantasma" onClick={() => void revogar()}>Desligar chave</button>}
        </div>
      </div>

      <div className="cfg-bloco">
        <h2 className="cfg-bloco__titulo">Como conectar</h2>
        <p className="cfg-bloco__dica">Envie a chave no cabeçalho <code>x-api-key</code>. As respostas vêm em JSON. Passe estes dados para quem vai fazer a integração.</p>
        <CampoCopiavel rotulo="Endereço da API" valor={BASE_API} />
        <div className="cfg-rotas">
          {ROTAS.map((x) => (
            <div key={x.caminho} className="cfg-rota">
              <span className={`cfg-rota__metodo cfg-rota__metodo--${x.metodo.toLowerCase()}`}>{x.metodo}</span>
              <code>{x.caminho}</code>
              <small>{x.descricao}</small>
            </div>
          ))}
        </div>
        <div className="campo cfg-campo">
          <span>Exemplo</span>
          <pre className="cfg-codigo">{exemplo}</pre>
        </div>
      </div>

      <div className="cfg-bloco cfg-bloco--vazio">
        <Plug size={34} strokeWidth={1.5} />
        <strong>Integrações prontas (iFood, nota fiscal…) em breve</strong>
        <p>Enquanto isso, qualquer sistema pode se conectar pela chave acima. Precisa de ajuda? Fale com o suporte.</p>
      </div>
    </PaginaConfig>
  );
}
