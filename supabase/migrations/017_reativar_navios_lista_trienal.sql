-- =====================================================================
-- SISCONT - 017: Reativar navios desativados que constam na lista trienal
-- ---------------------------------------------------------------------
-- Fonte: HISTORICO_TRIENAL2026 (abas LISTA DE NAVIOS e DIARIAS): 107 navios.
-- Reativa os navios desativados no cadastro cujo nome (ou outro nome) consta
-- na lista. Os que NÃO constam (baixados fisicamente) continuam desativados.
-- Idempotente: pode ser executado novamente.
-- O resultado mostra cada navio reativado e o nome da lista com que casou:
-- confira se algum casamento está errado. Para desfazer um deles, use o botão
-- Desativar em Cadastro > OM / Clientes.
-- =====================================================================

drop table if exists _lista_trienal;
create temp table _lista_trienal (nome text);
insert into _lista_trienal values
    ('Almirante Gastão Motta'),
    ('Almirante Graça Aranha'),
    ('Almirante Maximiano'),
    ('Almirante Saboia'),
    ('Alte. Leverger'),
    ('Amapá'),
    ('Amazonas'),
    ('Amorim do Valle'),
    ('Antares'),
    ('Apa'),
    ('Araçatuba'),
    ('Araguari'),
    ('Aratu'),
    ('Ary Rongel'),
    ('Aspirante Moura'),
    ('Aspirante Nascimento'),
    ('Atalaia'),
    ('Atlântico'),
    ('AviPa Albacora'),
    ('AviPa Anequim'),
    ('AviPa Marlim'),
    ('Aviso Rio Chuí'),
    ('Babitonga'),
    ('Bahia'),
    ('Benevente'),
    ('Bigua'),
    ('Bocaina'),
    ('Bracuí'),
    ('Brasil'),
    ('Caravelas'),
    ('Carlos Chagas'),
    ('Cisne Branco'),
    ('Comandante Manhães'),
    ('Comandante Varella'),
    ('Constituição'),
    ('Corveta Barroso'),
    ('Corveta Imperial Marinheiro Caboclo'),
    ('Corveta Julio de Noronha'),
    ('Cruzeiro do Sul'),
    ('Defensora'),
    ('Doutor Montenegro'),
    ('EDCG Camboriu'),
    ('EDCG Guarapari'),
    ('EDCG Marambaia'),
    ('EDCG Tambaú'),
    ('Faroleiro Mario Seixas'),
    ('Garça'),
    ('Garnier Sampaio'),
    ('Goiana'),
    ('Grajaú'),
    ('Graúna'),
    ('Gravataí'),
    ('Guaíba'),
    ('Guajará'),
    ('Guanabara'),
    ('Guaporé'),
    ('Guaratuba'),
    ('Guarda-Marinha Brito'),
    ('Guarda-Marinha Jansen'),
    ('Guarujá'),
    ('Guillobel'),
    ('Gurupá'),
    ('Gurupi'),
    ('Humaitá'),
    ('Iguatemi'),
    ('Independência'),
    ('Liberal'),
    ('Macaé'),
    ('Macau'),
    ('Maracanã'),
    ('Mearim'),
    ('Oswaldo Cruz'),
    ('Pampeiro'),
    ('Pará'),
    ('Paraguassu'),
    ('Parnaíba'),
    ('Pedro Teixeira'),
    ('Pelicano'),
    ('Penedo'),
    ('Pirajá'),
    ('Piratini'),
    ('Potengi'),
    ('Poti'),
    ('Purus'),
    ('Rademaker'),
    ('Raposo Tavares'),
    ('Riachuelo'),
    ('Rio Branco'),
    ('Rio Negro'),
    ('Rio Solimões'),
    ('Rio Tocantins'),
    ('Rio Xingu'),
    ('Rondônia'),
    ('Roraima'),
    ('Soares de Meirelles'),
    ('Tapajó'),
    ('Taurus'),
    ('Tenente Boanerges'),
    ('Tenente Castelo'),
    ('Tenente Maximiano'),
    ('Tikuna'),
    ('Timbira'),
    ('Tritão'),
    ('Triunfo'),
    ('Tupi'),
    ('União'),
    ('Vital de Oliveira');

with norm as (
  -- nome sem acento/pontuação, palavras separadas por espaço, com espaços nas pontas
  select nome as original,
         ' ' || trim(regexp_replace(lower(translate(nome,
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', ' ', 'g')) || ' ' as chave
    from _lista_trienal
), alvo as (
  select o.id, o.nome, n.original as nome_na_lista
    from public.oms o
    join norm n on
      ' ' || trim(regexp_replace(lower(translate(o.nome,
         'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', ' ', 'g')) || ' ' like '%' || n.chave || '%'
      or exists (select 1 from unnest(coalesce(o.nomes_alternativos, '{}')) a
                  where ' ' || trim(regexp_replace(lower(translate(a,
                    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', ' ', 'g')) || ' ' like '%' || n.chave || '%')
   where o.tipo = 'NAVIO' and o.ativo = false
), reativados as (
  update public.oms o
     set ativo = true, desativado_em = null, motivo_desativacao = null
    from (select distinct on (id) id, nome_na_lista from alvo order by id, nome_na_lista) a
   where o.id = a.id
  returning o.codigo, o.nome, a.nome_na_lista
)
select codigo, nome as navio_reativado, nome_na_lista as casou_com from reativados order by nome;

-- Conferência (rode depois): navios que continuam desativados = baixados fisicamente
-- select codigo, nome, desativado_em, motivo_desativacao from public.oms where tipo = 'NAVIO' and ativo = false order by nome;

