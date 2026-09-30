/* ===========================================================================
   Check das eleições favoritas (js/favoritos.js).

   O que aqui importa não é se o botão pinta: é a ORDEM em que aplicar() mexe
   nos controles. Trocar o ano depois do cargo restaura a eleição certa com o
   cargo errado — e em silêncio, porque updateCargoChipsVisibility() derruba o
   cargo para presidente sem erro nenhum no console. Foi por isso que este
   arquivo existe.

       node scripts/testar_favoritos.js
   =========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.resolve(__dirname, '..');
let falhas = 0;

function ok(condicao, rotulo, detalhe) {
  if (condicao) {
    console.log('  [ok ] ' + rotulo);
  } else {
    falhas++;
    console.log('  [ERRO] ' + rotulo + (detalhe ? '  -> ' + detalhe : ''));
  }
}

/* ------------------------------------------------------------- DOM mínimo */

/* favoritos.js só precisa de três coisas de um <select>: `value` que dispara o
   dropdown customizado, `dispatchEvent` e a lista de `options`. O log é o que
   transforma isso em asserção sobre ordem. */
function criarAmbiente({ municipios = [], ocultos = [], bloqueado = false } = {}) {
  const log = [];

  function select(id, valor, opcoes) {
    return {
      id,
      value: valor,
      options: (opcoes || []).map((v) => ({ value: v })),
      addEventListener() {},
      dispatchEvent(ev) { log.push(`change:${id}=${this.value}:${ev.type}`); }
    };
  }

  function chip(valor, extra) {
    const classes = new Set(extra && extra.hidden ? ['hidden'] : []);
    if (extra && extra.ativo) classes.add('active');
    return {
      dataset: { value: valor, type: extra && extra.type },
      textContent: extra && extra.texto ? extra.texto : valor,
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
      },
      click() { log.push(`chip:${valor || (extra && extra.type)}`); }
    };
  }

  function grupo(chips) {
    return {
      _chips: chips,
      addEventListener() {},
      querySelector(sel) {
        const mv = /data-value="([^"]+)"/.exec(sel);
        const mt = /data-type="([^"]+)"/.exec(sel);
        if (sel.includes('.active')) return chips.find((c) => c.classList.contains('active')) || null;
        if (mv) return chips.find((c) => c.dataset.value === mv[1]) || null;
        if (mt) return chips.find((c) => c.dataset.type === mt[1]) || null;
        return null;
      },
      querySelectorAll() { return chips; }
    };
  }

  const cargosGerais = ['presidente', 'governador', 'senador', 'deputado_federal']
    .map((v) => chip(v, {
      ativo: v === 'presidente',
      hidden: ocultos.includes(v),
      texto: v === 'deputado_federal' ? 'Dep. Federal' : v[0].toUpperCase() + v.slice(1)
    }));

  const dom = {
    selectElectionLevel: select('tipo', 'geral', ['geral', 'municipal']),
    selectUFGeneral: select('ufGeral', 'BR', ['BR', 'MG', 'SP']),
    selectYearGeneral: select('anoGeral', '2022', ['2022', '2018', '1989']),
    selectUFMunicipal: select('ufMun', 'AC', ['AC', 'SP']),
    selectYearMunicipal: select('anoMun', '2024', ['2024', '2020']),
    selectMunicipio: select('municipio', '', ['', ...municipios]),
    cargoChipsGeneral: grupo(cargosGerais),
    cargoChipsGeneralSubtype: grupo([chip(null, { type: 'ord', ativo: true }), chip(null, { type: 'sup' })]),
    officeChipsMunicipal: grupo([chip('prefeito', { ativo: true, texto: 'Prefeito' }),
      chip('vereador', { texto: 'Vereador' })])
  };

  const guardado = {};
  const avisos = [];
  const contexto = {
    console,
    dom,
    log,
    avisos,
    toTitleCase: (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    showToast: (m) => avisos.push(m),
    Event: class { constructor(t) { this.type = t; } },
    document: { getElementById: () => null },
    JSON, Array, Object, String, Number
  };
  /* Aba privada com dados de site bloqueados: o navegador lança no ACESSO, não
     devolve null. É o caso que derrubaria o init() inteiro se favoritos.js não
     envolvesse cada leitura e escrita em try/catch. */
  contexto.window = {
    localStorage: bloqueado ? {
      getItem() { throw new Error('SecurityError'); },
      setItem() { throw new Error('SecurityError'); }
    } : {
      getItem: (k) => (k in guardado ? guardado[k] : null),
      setItem: (k, v) => { guardado[k] = String(v); }
    }
  };
  vm.createContext(contexto);

  const fonte = fs.readFileSync(path.join(RAIZ, 'js', 'favoritos.js'), 'utf8');
  const F = vm.runInContext(fonte + '\n;FAVORITOS;', contexto, { filename: 'favoritos.js' });
  return { F, dom, log, avisos, guardado };
}

/* ------------------------------------------------ identidade e rótulo */

console.log('identidade de uma favorita');
{
  const { F } = criarAmbiente();
  const base = { tipo: 'geral', uf: 'MG', ano: '2018', municipio: '', cargo: 'governador', subtipo: '' };
  ok(F.id(base) === F.id({ ...base, rotulo: 'outro texto' }),
    'o rótulo não entra na identidade — senão a mesma eleição viraria duas favoritas');
  ok(F.id(base) !== F.id({ ...base, ano: '2022' }), 'ano diferente é favorita diferente');
  ok(F.id(base) !== F.id({ ...base, cargo: 'senador' }), 'cargo diferente é favorita diferente');
  ok(F.id(base) !== F.id({ ...base, subtipo: 'sup' }), 'suplementar é favorita diferente da ordinária');
}

console.log('\nrótulo do chip');
{
  const { F } = criarAmbiente({ municipios: ['SANTOS'] });
  ok(F.rotuloDe({ tipo: 'geral', uf: 'BR', ano: '2018', municipio: '', cargo: 'presidente', subtipo: '' })
    === '2018 · Presidente · Brasil', 'nacional vira "Brasil", não "BR"');
  ok(F.rotuloDe({ tipo: 'geral', uf: 'MG', ano: '2022', municipio: '', cargo: 'deputado_federal', subtipo: '' })
    === '2022 · Dep. Federal · MG', 'o texto do cargo sai do próprio chip');
  ok(F.rotuloDe({ tipo: 'municipal', uf: 'SP', ano: '2024', municipio: 'SANTOS', cargo: 'prefeito', subtipo: '' })
    === '2024 · Prefeito · Santos/SP', 'município entra com caixa de nome próprio');
  ok(F.rotuloDe({ tipo: 'geral', uf: 'MG', ano: '2014', municipio: '', cargo: 'governador', subtipo: 'sup' })
    .includes('(sup.)'), 'suplementar se identifica no rótulo');
}

/* -------------------------------------------------------- ordem de aplicar */

console.log('\nordem em que aplicar() mexe nos controles');
{
  const { F, log } = criarAmbiente();
  F.aplicar({ tipo: 'geral', uf: 'MG', ano: '2018', municipio: '', cargo: 'governador', subtipo: '' });

  const iAno = log.findIndex((l) => l.startsWith('change:anoGeral'));
  const iUF = log.findIndex((l) => l.startsWith('change:ufGeral'));
  const iCargo = log.findIndex((l) => l === 'chip:governador');

  ok(iUF >= 0 && iAno >= 0 && iCargo >= 0, 'UF, ano e cargo todos foram aplicados', log.join(' | '));
  ok(iUF < iAno, 'UF antes do ano — no municipal é ela que popula a lista de municípios');
  ok(iAno < iCargo,
    'ANO ANTES DO CARGO: invertido, updateCargoChipsVisibility derruba o cargo para presidente em silêncio',
    log.join(' | '));
}

console.log('\nnão mexe no que já está certo');
{
  const { F, log } = criarAmbiente();
  // o ambiente já nasce em geral/BR/2022/presidente
  F.aplicar({ tipo: 'geral', uf: 'BR', ano: '2022', municipio: '', cargo: 'presidente', subtipo: '' });
  ok(log.length === 0,
    'favorita igual ao estado atual não dispara change nenhum — cada um limpa cache e refaz carga',
    log.join(' | '));
}

console.log('\nmunicipal');
{
  const { F, log, avisos } = criarAmbiente({ municipios: ['SANTOS'] });
  F.aplicar({ tipo: 'municipal', uf: 'SP', ano: '2024', municipio: 'SANTOS', cargo: 'vereador', subtipo: '' });
  const ordem = log.join(' | ');
  const iUF = log.findIndex((l) => l.startsWith('change:ufMun'));
  const iMun = log.findIndex((l) => l.startsWith('change:municipio'));
  ok(iUF >= 0 && iMun > iUF, 'UF antes do município: a lista de municípios só existe depois dela', ordem);
  ok(log.includes('chip:vereador'), 'cargo municipal aplicado', ordem);
  ok(avisos.length === 0, 'município existente não gera aviso', avisos.join(' | '));
}

console.log('\nmunicípio que não está no índice');
{
  const { F, log, avisos } = criarAmbiente({ municipios: ['SANTOS'] });
  F.aplicar({ tipo: 'municipal', uf: 'SP', ano: '2024', municipio: 'CIDADE QUE NAO EXISTE', cargo: 'prefeito', subtipo: '' });
  ok(avisos.some((a) => /resumo estadual/i.test(a)),
    'avisa em vez de falhar calado — atribuir value inexistente deixaria o select vazio',
    avisos.join(' | '));
  ok(!log.some((l) => l.startsWith('change:municipio')),
    'e não dispara o change do município, que abriria a eleição errada');
}

console.log('\ncargo que não existe no ano escolhido');
{
  const { F, avisos } = criarAmbiente({ ocultos: ['governador'] });
  F.aplicar({ tipo: 'geral', uf: 'BR', ano: '1989', municipio: '', cargo: 'governador', subtipo: '' });
  ok(avisos.some((a) => /cargo/i.test(a)),
    '1989 só teve presidente: avisa em vez de clicar num chip escondido', avisos.join(' | '));
}

/* ------------------------------------------------------------ persistência */

console.log('\nguardar e remover');
{
  const { F, guardado } = criarAmbiente();
  F.alternar();
  let lista = F.ler();
  ok(lista.length === 1, 'a estrela salva a eleição da tela', JSON.stringify(lista));
  ok(guardado[F.CHAVE] !== undefined, 'gravou na chave em_favoritos');

  F.alternar();
  ok(F.ler().length === 0, 'a estrela no mesmo contexto remove, não duplica');

  F.alternar();
  F.alternar();
  ok(F.ler().length === 0, 'alternar duas vezes volta ao início');
}

console.log('\nlocalStorage bloqueado (aba privada)');
{
  const { F, avisos } = criarAmbiente({ bloqueado: true });
  let lancou = false;
  try {
    ok(Array.isArray(F.ler()) && F.ler().length === 0, 'ler() devolve lista vazia em vez de lançar');
    F.alternar();
    F.desenhar();
    F.sincronizar();
  } catch (e) {
    lancou = true;
  }
  ok(!lancou, 'nenhuma operação lança — senão o init() da página inteira morria aqui');
  ok(avisos.some((a) => /armazenamento local/i.test(a)),
    'e o usuário é avisado de que o navegador está bloqueando', avisos.join(' | '));
}

console.log('\nlista corrompida no armazenamento');
{
  const { F, guardado } = criarAmbiente();
  guardado[F.CHAVE] = '{isso nao e json';
  ok(F.ler().length === 0, 'JSON inválido vira lista vazia, não exceção');
  guardado[F.CHAVE] = '[{"lixo":1},{"tipo":"geral","ano":"2018"}]';
  ok(F.ler().length === 1, 'entrada sem tipo/ano é descartada e o resto sobrevive');
}

console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'tudo certo'));
process.exit(falhas ? 1 : 0);
