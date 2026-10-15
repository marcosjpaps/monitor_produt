#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
FastAPI Server for Agricultural Telemetry Monitor (John Deere G5 .JDL)
Suporta ingestão massiva da pasta raiz JD-Data com subpastas de talhões/atividades.
"""

import os
import glob
from typing import List, Optional
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Body, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .db import (
    init_db, is_file_processed, get_processed_md5_set, save_parsed_session,
    get_dashboard_kpis, get_all_sessions, get_timeseries_data,
    get_map_routes, get_atividades, get_fazendas_e_atividades, get_operacoes, get_connection,
    delete_session, restore_session, get_filtros_equipamento, get_segmentacao_filtros,
    delete_sessions_batch, restore_sessions_batch
)
from .parser import JDLParser
from .aggps_parser import (
    get_aggps_kpis,
    get_aggps_events_list,
    get_aggps_coverage_geojson,
    get_aggps_swaths_geojson,
    get_aggps_farms_and_fields,
    get_active_aggps_path,
    set_active_aggps_path,
    list_candidate_aggps_paths,
    _find_aggps_dir
)
from .massey_engine import (
    get_massey_stats,
    get_massey_operations,
    get_massey_operation_by_id,
    get_massey_farm_fields,
    get_massey_farm_fields_geojson
)

from .archive_utils import safe_name, safe_extract, extract_rar as _extract_rar

app = FastAPI(
    title="Monitor Agrícola Multi-Máquinas (John Deere G5 & Jacto AgGPS)",
    description="Telemetria e Cobertura Agrícola Operacional Multi-Máquinas",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:" + os.environ.get("PORT", "3000"), "http://localhost:" + os.environ.get("PORT", "3000")],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .auth import COOKIE_NAME, create_session, current_user, check_credentials, forbid


class LoginPayload(BaseModel):
    email: str
    password: str
    remember: bool = True


@app.middleware("http")
async def protect_operational_apis(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and not path.startswith("/api/auth/") and path != "/api/health":
        if not current_user(request):
            return forbid()
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin:
                from urllib.parse import urlparse
                parsed = urlparse(origin)
                if parsed.scheme not in ("http", "https") or parsed.netloc.lower() != request.headers.get("host", "").lower():
                    return JSONResponse({"error": "Origem não autorizada."}, status_code=403)
    return await call_next(request)


@app.post("/api/auth/login")
async def api_login(payload: LoginPayload, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    valid, status = check_credentials(payload.email, payload.password, client_ip)
    if not valid:
        message = "Autenticação não configurada no servidor." if status == 503 else (
            "Muitas tentativas. Tente novamente mais tarde." if status == 429 else "E-mail ou senha incorretos."
        )
        return JSONResponse({"error": message}, status_code=status)
    token, max_age = create_session(payload.email.strip(), payload.remember)
    response = JSONResponse({"success": True, "email": payload.email.strip().lower()})
    response.set_cookie(COOKIE_NAME, token, max_age=max_age, httponly=True,
                        secure=(os.environ.get("APP_ENV") == "production" or request.url.scheme == "https"),
                        samesite="lax", path="/")
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/auth/me")
def api_current_user(request: Request):
    user = current_user(request)
    if not user:
        return forbid()
    response = JSONResponse({"authenticated": True, "email": user})
    response.headers["Cache-Control"] = "no-store"
    return response


@app.post("/api/auth/logout")
def api_logout(request: Request):
    response = JSONResponse({"success": True})
    response.delete_cookie(COOKIE_NAME, path="/")
    response.headers["Cache-Control"] = "no-store"
    return response


FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend")

@app.on_event("startup")
def startup_event():
    init_db()
    from .massey_import import connect
    connect().close()
    # Sincroniza arquivos locais padrão caso existam
    sync_default_local_files()
    # Histórico único de importações; reidrata os dados AgGPS em /tmp na nuvem.
    from .import_store import init_import_store, hydrate_jacto_imports
    init_import_store()
    hydrate_jacto_imports()

def sync_default_local_files():
    # Caminho configurável via variável de ambiente (sem hardcode de máquina específica)
    default_dir = os.environ.get(
        "JD_DATA_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "samples")
    )
    count = 0
    if os.path.exists(default_dir):
        jdl_files = glob.glob(os.path.join(default_dir, "**", "*.jdl"), recursive=True) + \
                    glob.glob(os.path.join(default_dir, "**", "*.JDL"), recursive=True)
        processed_set = get_processed_md5_set()
        with get_connection() as conn:
            for fpath in sorted(jdl_files):
                try:
                    parser = JDLParser.from_file(fpath)
                    if parser.md5 not in processed_set:
                        parsed = parser.parse()
                        save_parsed_session(parsed, conn_external=conn)
                        processed_set.add(parser.md5)
                        count += 1
                except Exception as e:
                    print(f"[AVISO] Falha ao sincronizar {fpath}: {e}")
            conn.commit()
    return count


@app.get("/api/dashboard/kpis")
def api_kpis(
    maquina_id: Optional[str] = Query(None),
    atividade: Optional[str] = Query(None),
    fazenda: Optional[str] = Query(None),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    operacao: Optional[str] = Query(None),
    trator: Optional[str] = Query(None),
    implemento: Optional[str] = Query(None),
    faixa_real: Optional[str] = Query(None),
    operador: Optional[str] = Query(None)
):
    """Retorna os indicadores chave de desempenho (KPIs) operacionais, com filtros opcionais."""
    return get_dashboard_kpis(
        maquina_id=maquina_id, 
        atividade=atividade,
        fazenda=fazenda,
        data_inicio=data_inicio,
        data_fim=data_fim,
        operacao=operacao,
        trator=trator,
        implemento=implemento,
        faixa_real=faixa_real,
        operador=operador
    )

@app.get("/api/dashboard/series")
def api_timeseries(
    arquivo_id: Optional[str] = Query(None),
    maquina_id: Optional[str] = Query(None),
    atividade: Optional[str] = Query(None),
    fazenda: Optional[str] = Query(None),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    operacao: Optional[str] = Query(None),
    trator: Optional[str] = Query(None),
    implemento: Optional[str] = Query(None),
    faixa_real: Optional[str] = Query(None),
    operador: Optional[str] = Query(None),
    limit: int = Query(2500)
):
    """Retorna a série temporal de RPM, velocidade, horímetro e carga para gráficos."""
    return get_timeseries_data(
        arquivo_id=arquivo_id, 
        maquina_id=maquina_id, 
        atividade=atividade,
        fazenda=fazenda,
        data_inicio=data_inicio,
        data_fim=data_fim,
        operacao=operacao,
        trator=trator,
        implemento=implemento,
        faixa_real=faixa_real,
        operador=operador,
        limit=limit
    )

@app.get("/api/dashboard/mapa")
def api_map_routes(
    arquivo_id: Optional[str] = Query(None),
    maquina_id: Optional[str] = Query(None),
    atividade: Optional[str] = Query(None),
    fazenda: Optional[str] = Query(None),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    operacao: Optional[str] = Query(None),
    trator: Optional[str] = Query(None),
    implemento: Optional[str] = Query(None),
    faixa_real: Optional[str] = Query(None),
    operador: Optional[str] = Query(None)
):
    """Retorna as coordenadas e trajetórias de GPS para o mapa Leaflet."""
    return get_map_routes(
        arquivo_id=arquivo_id, 
        maquina_id=maquina_id, 
        atividade=atividade,
        fazenda=fazenda,
        data_inicio=data_inicio,
        data_fim=data_fim,
        operacao=operacao,
        trator=trator,
        implemento=implemento,
        faixa_real=faixa_real,
        operador=operador
    )

@app.get("/api/arquivos")
def api_arquivos(
    maquina_id: Optional[str] = Query(None),
    atividade: Optional[str] = Query(None),
    fazenda: Optional[str] = Query(None),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
    operacao: Optional[str] = Query(None),
    trator: Optional[str] = Query(None),
    implemento: Optional[str] = Query(None),
    faixa_real: Optional[str] = Query(None),
    operador: Optional[str] = Query(None)
):
    """Lista todos os arquivos .JDL processados no sistema com filtros."""
    return get_all_sessions(
        maquina_id=maquina_id, 
        atividade=atividade,
        fazenda=fazenda,
        data_inicio=data_inicio,
        data_fim=data_fim,
        operacao=operacao,
        trator=trator,
        implemento=implemento,
        faixa_real=faixa_real,
        operador=operador
    )

@app.get("/api/filtros/equipamentos")
def api_filtros_equipamentos():
    """Retorna as opções únicas para os filtros de Trator, Implemento e Faixa Real."""
    return get_filtros_equipamento()

@app.get("/api/filtros/segmentacao")
def api_filtros_segmentacao(
    fazenda: Optional[str] = Query(None),
    atividade: Optional[str] = Query(None),
    operacao: Optional[str] = Query(None),
    trator: Optional[str] = Query(None),
    implemento: Optional[str] = Query(None),
    faixa_real: Optional[str] = Query(None),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None),
):
    """
    Retorna a segmentação de dados cruzada (Power BI / Excel Slicers):
    Calcula dinamicamente as opções válidas e contagens para cada dimensão
    baseado nos outros filtros atualmente selecionados.
    """
    return get_segmentacao_filtros(
        fazenda=fazenda,
        atividade=atividade,
        operacao=operacao,
        trator=trator,
        implemento=implemento,
        faixa_real=faixa_real,
        data_inicio=data_inicio,
        data_fim=data_fim
    )

@app.post("/api/rastro/excluir")
def api_excluir_rastro(arquivo_id: str = Query(...)):
    """Apara/Exclui o rastro selecionado pelo usuário no mapa."""
    success = delete_session(arquivo_id)
    if not success:
        raise HTTPException(status_code=404, detail="Rastro não encontrado.")
    return {
        "success": True,
        "arquivo_id": arquivo_id,
        "message": "Rastro excluído com sucesso do mapa e cálculos.",
        "kpis": get_dashboard_kpis()
    }

@app.post("/api/rastro/restaurar")
def api_restaurar_rastro(arquivo_id: str = Query(...)):
    """Restaura o rastro previamente excluído."""
    success = restore_session(arquivo_id)
    if not success:
        raise HTTPException(status_code=404, detail="Rastro não encontrado.")
    return {
        "success": True,
        "arquivo_id": arquivo_id,
        "message": "Rastro restaurado com sucesso.",
        "kpis": get_dashboard_kpis()
    }

class BatchTrackRequest(BaseModel):
    arquivo_ids: List[str]

@app.post("/api/rastro/excluir-lote")
def api_excluir_rastros_lote(req: BatchTrackRequest):
    """Exclui múltiplos rastros selecionados de uma vez no mapa ou tabela."""
    count = delete_sessions_batch(req.arquivo_ids)
    return {
        "success": True,
        "deleted_count": count,
        "arquivo_ids": req.arquivo_ids,
        "message": f"{count} rastros excluídos com sucesso.",
        "kpis": get_dashboard_kpis()
    }

@app.post("/api/rastro/restaurar-lote")
def api_restaurar_rastros_lote(req: BatchTrackRequest):
    """Restaura múltiplos rastros previamente excluídos em lote."""
    count = restore_sessions_batch(req.arquivo_ids)
    return {
        "success": True,
        "restored_count": count,
        "arquivo_ids": req.arquivo_ids,
        "message": f"{count} rastros restaurados com sucesso.",
        "kpis": get_dashboard_kpis()
    }

@app.get("/api/fazendas")
def api_fazendas():
    """Retorna a lista de Fazendas e seus respectivos talhões."""
    return get_fazendas_e_atividades()

@app.get("/api/operacoes")
def api_operacoes():
    """Retorna tipos de operação registrados no sistema."""
    return get_operacoes()

@app.get("/api/atividades")
def api_atividades():
    """Retorna a lista de todas as atividades/talhões importados da pasta JD-Data."""
    return get_atividades()

@app.get("/api/maquinas")
def api_maquinas():
    """Lista as máquinas cadastradas e seus horímetros atuais."""
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM maquinas ORDER BY horimetro_atual DESC;").fetchall()
        return [dict(r) for r in rows]

@app.post("/api/upload")
async def api_upload(files: List[UploadFile] = File(...)):
    """
    Recebe lote de arquivos .JDL ou pacotes compactados .ZIP / .RAR.
    Descompacta recursivamente e extrai telemetria de tratores John Deere G5.
    """
    import tempfile
    import zipfile

    results = []
    processed_set = get_processed_md5_set()

    with get_connection() as conn:
        for file in files:
            try: fname = safe_name(file.filename)
            except ValueError as e:
                results.append({"filename":file.filename,"status":"error","message":str(e)})
                continue
            lower_name = fname.lower()
            raw_bytes = await file.read(50 * 1024 * 1024 + 1)
            if len(raw_bytes) > 50 * 1024 * 1024:
                results.append({"filename":fname,"status":"error","message":"Arquivo excede 50 MB"})
                continue

            # CASO 1: Arquivo Compactado (.zip ou .rar)
            if lower_name.endswith(".zip") or lower_name.endswith(".rar"):
                try:
                    with tempfile.TemporaryDirectory(prefix="up_arch_") as tmp_dir:
                        archive_path = os.path.join(tmp_dir, os.path.basename(fname))
                        with open(archive_path, "wb") as af:
                            af.write(raw_bytes)

                        extract_dir = os.path.join(tmp_dir, "extracted")
                        os.makedirs(extract_dir, exist_ok=True)

                        if lower_name.endswith(".zip"):
                            with zipfile.ZipFile(archive_path, "r") as zf:
                                safe_extract(zf, extract_dir)
                        else:
                            _extract_rar(archive_path, extract_dir)

                        # Varre por arquivos .JDL internos
                        found_jdls = []
                        for root, _, fnames in os.walk(extract_dir):
                            for f in fnames:
                                if f.lower().endswith(".jdl"):
                                    found_jdls.append(os.path.join(root, f))

                        if found_jdls:
                            for jdl_path in found_jdls:
                                rel_jdl_name = os.path.relpath(jdl_path, extract_dir)
                                with open(jdl_path, "rb") as jf:
                                    j_bytes = jf.read()
                                try:
                                    parser = JDLParser(j_bytes, rel_jdl_name)
                                    if parser.md5 in processed_set:
                                        results.append({
                                            "filename": os.path.basename(rel_jdl_name),
                                            "status": "skipped",
                                            "message": "Arquivo já importado anteriormente (MD5 idêntico)."
                                        })
                                        continue

                                    parsed = parser.parse()
                                    aid = save_parsed_session(parsed, conn_external=conn)
                                    processed_set.add(parser.md5)

                                    results.append({
                                        "filename": os.path.basename(rel_jdl_name),
                                        "status": "imported",
                                        "arquivo_id": aid,
                                        "atividade": parsed["file_info"]["atividade_pasta"] or "Geral",
                                        "machine": parsed["machine_metadata"].get("tractor_model") or "John Deere",
                                        "serial": parsed["machine_metadata"].get("tractor_serial"),
                                        "records_count": len(parsed.get("time_series_points", []))
                                    })
                                except Exception as err:
                                    results.append({
                                        "filename": os.path.basename(rel_jdl_name),
                                        "status": "error",
                                        "message": str(err)
                                    })
                        else:
                            results.append({
                                "filename": fname,
                                "status": "skipped",
                                "message": "Nenhum arquivo .JDL encontrado dentro do pacote compactado."
                            })

                except Exception as e:
                    results.append({
                        "filename": fname,
                        "status": "error",
                        "message": f"Falha ao extrair e indexar pacote compactado: {str(e)}"
                    })
                continue

            # CASO 2: Arquivo Direto .JDL
            elif lower_name.endswith(".jdl"):
                try:
                    parser = JDLParser(raw_bytes, fname)
                    if parser.md5 in processed_set:
                        results.append({
                            "filename": os.path.basename(fname),
                            "status": "skipped",
                            "message": "Arquivo já importado anteriormente (MD5 idêntico)."
                        })
                        continue

                    parsed = parser.parse()
                    arquivo_id = save_parsed_session(parsed, conn_external=conn)
                    processed_set.add(parser.md5)

                    results.append({
                        "filename": os.path.basename(fname),
                        "status": "imported",
                        "arquivo_id": arquivo_id,
                        "atividade": parsed["file_info"]["atividade_pasta"] or "João Pinheiro - MG",
                        "machine": parsed["machine_metadata"].get("tractor_model") or "John Deere 6150M",
                        "serial": parsed["machine_metadata"].get("tractor_serial"),
                        "horimeter_final": parsed["telemetry_summary"]["horimeter"]["final_hours"],
                        "records_count": len(parsed.get("time_series_points", []))
                    })
                except Exception as e:
                    results.append({
                        "filename": os.path.basename(fname),
                        "status": "error",
                        "message": str(e)
                    })
                continue

            else:
                results.append({
                    "filename": fname,
                    "status": "rejected",
                    "message": "Formato não suportado. Aceita arquivos .JDL ou pacotes .ZIP / .RAR com telemetria."
                })

        conn.commit()

    return {
        "total_recebidos": len(files),
        "resultados": results,
        "kpis": get_dashboard_kpis()
    }

@app.post("/api/scan-folder")
def api_scan_folder(payload: Optional[dict] = None):
    """
    Varre recursivamente a pasta raiz JD-Data (ou qualquer subpasta)
    e importa todos os arquivos .JDL em alta performance (bulk transactions).
    """
    default_jd_data = r"C:\Users\Topologia\Desktop\ORGANO MINERAL\JD-Data"
    folder_path = (payload.get("folder_path") if payload else None) or default_jd_data
    folder_path = os.path.normpath(folder_path.strip('"').strip("'"))

    if not os.path.exists(folder_path):
        return {
            "status": "not_found",
            "folder": folder_path,
            "total_encontrados": 0,
            "importados": 0,
            "duplicados_ignorados": 0,
            "erros": 0,
            "is_cloud": True,
            "message": f"Diretório local '{folder_path}' não está acessível no servidor em nuvem. Selecione a pasta pelo navegador.",
            "kpis": get_dashboard_kpis()
        }

    # Encontra todos os arquivos .JDL recursivamente
    jdl_files = []
    for root, _, files in os.walk(folder_path):
        for f in files:
            if f.lower().endswith(".jdl"):
                jdl_files.append(os.path.join(root, f))

    total_found = len(jdl_files)
    if total_found == 0:
        return {
            "folder": folder_path,
            "total_encontrados": 0,
            "importados": 0,
            "duplicados_ignorados": 0,
            "erros": 0,
            "message": "Nenhum arquivo .JDL encontrado neste diretório.",
            "kpis": get_dashboard_kpis()
        }

    processed_set = get_processed_md5_set()
    imported = 0
    skipped = 0
    errors = 0

    with get_connection() as conn:
        for idx, fpath in enumerate(sorted(jdl_files), 1):
            try:
                parser = JDLParser.from_file(fpath)
                if parser.md5 in processed_set:
                    skipped += 1
                else:
                    parsed = parser.parse()
                    save_parsed_session(parsed, conn_external=conn)
                    processed_set.add(parser.md5)
                    imported += 1

                # Commit a cada 100 arquivos para manter memória baixa e persistência garantida
                if idx % 100 == 0:
                    conn.commit()

            except Exception as e:
                errors += 1
                print(f"[ERRO] Falha ao processar {fpath}: {e}")

        conn.commit()

    return {
        "folder": folder_path,
        "total_encontrados": total_found,
        "importados": imported,
        "duplicados_ignorados": skipped,
        "erros": errors,
        "kpis": get_dashboard_kpis()
    }

@app.post("/api/sync-local")
@app.post("/api/sync-folder")
@app.post("/api/sync")
@app.get("/api/sync")
@app.get("/api/sync-local")
def api_sync_local():
    """Varre e sincroniza novamente a pasta local de logs."""
    synced = sync_default_local_files()
    kpis = get_dashboard_kpis()
    return {
        "message": f"Sincronização concluída ({synced} novos arquivos)",
        "synced": synced,
        "kpis": kpis
    }

# ==========================================
# ROTAS JOHN DEERE OPERATIONS CENTER & AMOSTRAS OFICIAIS
# ==========================================

from .jd_ops import get_available_jd_samples, parse_myjohndeere_shapefile

@app.get("/api/johndeere/amostras")
def api_jd_amostras_lista():
    """Retorna o catálogo de amostras reais do John Deere SampleData."""
    return get_available_jd_samples()

@app.get("/api/johndeere/amostras/{sample_id}")
def api_jd_amostra_detalhe(sample_id: str, max_points: int = Query(15000, ge=1, le=50000)):
    """Carrega uma amostra oficial com telemetria, corte de seções e receituário de tanque."""
    samples = get_available_jd_samples()
    target = next((s for s in samples if s["id"] == sample_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Amostra não encontrada.")
    return parse_myjohndeere_shapefile(target["shp_path"], max_points=max_points)

# ==========================================
# ROTAS ISO 11783 (ISOXML), ZONEAMENTO & JDLINK
# ==========================================
from fastapi.responses import Response
from .isoxml_engine import ISOBUS_DDI_CATALOG, generate_isoxml_taskdata_zip, parse_isoxml_content
from .zoning_engine import compute_agronomic_zoning
from .jdlink_bridge import get_jdlink_status

@app.get("/api/isoxml/ddis")
def api_isoxml_ddis():
    """Retorna o catálogo AEF de DDIs ISO 11783-11."""
    return list(ISOBUS_DDI_CATALOG.values())

@app.post("/api/agronomy/zoning")
def api_agronomy_zoning(payload: dict = Body(...)):
    """
    Calcula o zoneamento agronômico e grade regular a partir de pontos ou ID de amostra.
    Inspirado no TwinYields/farmingpy zoning.py.
    """
    sample_id = payload.get("sample_id")
    target_rate = payload.get("target_rate")
    grid_size_m = float(payload.get("grid_size_m", 10.0))
    points = payload.get("points")

    if not points and sample_id:
        samples = get_available_jd_samples()
        target = next((s for s in samples if s["id"] == sample_id), None)
        if target:
            parsed = parse_myjohndeere_shapefile(target["shp_path"], max_points=15000)
            points = parsed.get("pontos", [])
            if not target_rate:
                target_rate = parsed.get("kpis", {}).get("taxa_media", 12.5)

    if not points:
        # Fallback: carrega pontos da aplicação real do banco de dados local
        with get_connection() as conn:
            rows = conn.execute("""
                SELECT latitude, longitude, taxa_aplicacao
                FROM telemetria_registros
                WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND taxa_aplicacao > 0
                ORDER BY timestamp_ms DESC
                LIMIT 4000;
            """).fetchall()
            if rows:
                points = [
                    {"latitude": r["latitude"], "longitude": r["longitude"], "rate": r["taxa_aplicacao"]}
                    for r in rows
                ]
                if not target_rate:
                    target_rate = 5000.0

    if not points:
        raise HTTPException(status_code=400, detail="Pontos ou ID de amostra são obrigatórios.")

    return compute_agronomic_zoning(points, target_rate=target_rate, grid_size_m=grid_size_m)

@app.post("/api/isoxml/export")
def api_isoxml_export(payload: dict = Body(...)):
    """
    Gera um pacote TASKDATA.zip oficial compatível com monitores ISO 11783-10.
    Inspirado no Josephinum-Research/isoxml-py.
    """
    customer = payload.get("customer", "Produtor Agrícola")
    farm = payload.get("farm", "Fazenda Modelo")
    field = payload.get("field", "Talhão 01")
    task = payload.get("task", "Aplicação em Taxa Variável")
    session_data = payload.get("session_data", {})

    zip_bytes = generate_isoxml_taskdata_zip(
        session_data,
        customer_name=customer,
        farm_name=farm,
        field_name=field,
        task_name=task
    )

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="TASKDATA.zip"'}
    )

@app.get("/api/jdlink/fleet")
def api_jdlink_fleet():
    """Retorna o status em tempo real da frota conectada via JDLink MTG / Operations Center."""
    return get_jdlink_status()

# ==========================================
# ROTAS JACTO / TRIMBLE AgGPS (Shapefiles)
# ==========================================

class AgGPSDirConfig(BaseModel):
    path: str

@app.get("/api/jacto/config_dir")
def api_get_aggps_dir():
    """Retorna o diretório ativo da AgGPS e caminhos detectados no sistema."""
    current = get_active_aggps_path()
    resolved = _find_aggps_dir(current)
    candidates = list_candidate_aggps_paths()
    return {
        "active_path": current,
        "resolved_data_dir": resolved,
        "exists": os.path.exists(current),
        "candidates": candidates
    }

@app.post("/api/jacto/config_dir")
def api_set_aggps_dir(payload: AgGPSDirConfig):
    """Configura e valida uma nova pasta de dados AgGPS."""
    return set_active_aggps_path(payload.path)

@app.get("/api/jacto/kpis")
def api_jacto_kpis(
    diretorio: Optional[str] = Query(None),
    fazenda: Optional[str] = Query(None),
    talhao: Optional[str] = Query(None),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None)
):
    """Retorna KPIs operacionais consolidados da Jacto / Trimble AgGPS."""
    return get_aggps_kpis(
        root_dir=diretorio,
        fazenda=fazenda,
        talhao=talhao,
        data_inicio=data_inicio,
        data_fim=data_fim
    )

@app.get("/api/jacto/fazendas")
def api_jacto_fazendas(diretorio: Optional[str] = Query(None)):
    """Retorna lista de fazendas e talhões disponíveis nos arquivos AgGPS."""
    return get_aggps_farms_and_fields(root_dir=diretorio)

@app.get("/api/jacto/eventos")
def api_jacto_eventos(
    diretorio: Optional[str] = Query(None),
    fazenda: Optional[str] = Query(None),
    talhao: Optional[str] = Query(None),
    data_inicio: Optional[str] = Query(None),
    data_fim: Optional[str] = Query(None)
):
    """Retorna o histórico de eventos/sessões de pulverização da Jacto."""
    return get_aggps_events_list(
        root_dir=diretorio,
        fazenda=fazenda,
        talhao=talhao,
        data_inicio=data_inicio,
        data_fim=data_fim
    )

@app.get("/api/jacto/cobertura")
def api_jacto_cobertura(
    diretorio: Optional[str] = Query(None),
    fazenda: Optional[str] = Query(None),
    talhao: Optional[str] = Query(None),
    evento: Optional[str] = Query(None),
    max_features: int = Query(15000, ge=1, le=50000)
):
    """Retorna polígonos reais de cobertura (Coverage.shp) em GeoJSON para o Leaflet."""
    return get_aggps_coverage_geojson(
        root_dir=diretorio,
        fazenda=fazenda,
        talhao=talhao,
        event_name=evento,
        max_features=max_features
    )

@app.get("/api/jacto/linhas-guia")
def api_jacto_linhas_guia(
    diretorio: Optional[str] = Query(None),
    fazenda: Optional[str] = Query(None),
    talhao: Optional[str] = Query(None)
):
    """Retorna linhas e curvas de piloto automático (Swaths.shp) em GeoJSON."""
    return get_aggps_swaths_geojson(
        root_dir=diretorio,
        fazenda=fazenda,
        talhao=talhao
    )

@app.post("/api/jacto/upload")
async def api_jacto_upload(files: List[UploadFile] = File(...)):
    """
    Endpoint de Ingestão de Arquivos para o Cockpit Jacto Uniport / Trimble AgGPS.
    Aceita:
    1. Pacotes .ZIP e .RAR contendo pastas AgGPS (Coverage.shp, Swaths.shp, EventHistory.dbf).
    2. Componentes Shapefiles diretos (.shp, .dbf, .shx, .prj, .xml, .kml).
    3. Logs de telemetria John Deere (.jdl).
    """
    import tempfile
    import zipfile
    import shutil

    results = []
    active_path = get_active_aggps_path()
    aggps_target_dir = _find_aggps_dir(active_path)
    os.makedirs(aggps_target_dir, exist_ok=True)

    with get_connection() as conn:
        for file in files:
            try: fname = safe_name(file.filename)
            except ValueError as e:
                results.append({"filename":file.filename,"status":"error","message":str(e)})
                continue
            lower_name = fname.lower()
            raw_bytes = await file.read(50 * 1024 * 1024 + 1)
            if len(raw_bytes) > 50 * 1024 * 1024:
                results.append({"filename":fname,"status":"error","message":"Arquivo excede 50 MB"})
                continue

            # CASO 1: Pacote Compactado (.zip ou .rar)
            if lower_name.endswith(".zip") or lower_name.endswith(".rar"):
                try:
                    with tempfile.TemporaryDirectory(prefix="jacto_up_") as tmp_dir:
                        archive_path = os.path.join(tmp_dir, os.path.basename(fname))
                        with open(archive_path, "wb") as af:
                            af.write(raw_bytes)

                        extract_dir = os.path.join(tmp_dir, "extracted")
                        os.makedirs(extract_dir, exist_ok=True)

                        if lower_name.endswith(".zip"):
                            with zipfile.ZipFile(archive_path, "r") as zf:
                                safe_extract(zf, extract_dir)
                        else:
                            _extract_rar(archive_path, extract_dir)

                        aggps_files = []
                        jdl_files = []

                        for root, _, fnames in os.walk(extract_dir):
                            for f in fnames:
                                f_lower = f.lower()
                                full_f = os.path.join(root, f)
                                if any(f_lower.endswith(e) for e in (".shp", ".dbf", ".shx", ".prj", ".xml", ".kml")):
                                    aggps_files.append(full_f)
                                elif f_lower.endswith(".jdl"):
                                    jdl_files.append(full_f)

                        imported_any = False

                        # Se contém Shapefiles AgGPS (Coverage, Swaths, etc.)
                        if aggps_files:
                            from .vector_reader import Open
                            for candidate in aggps_files:
                                if candidate.lower().endswith('.shp'): Open(candidate)
                            folder_name = os.path.splitext(os.path.basename(fname))[0]
                            dest_folder = os.path.join(aggps_target_dir, "Importados_Jacto", folder_name)
                            os.makedirs(dest_folder, exist_ok=True)

                            for sf in aggps_files:
                                target_path = os.path.join(dest_folder, os.path.relpath(sf, extract_dir))
                                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                                shutil.copy2(sf, target_path)

                            results.append({
                                "filename": fname,
                                "status": "imported",
                                "type": "AgGPS Shapefiles (Jacto)",
                                "destination": f"Importados_Jacto/{folder_name}",
                                "files_count": len(aggps_files),
                                "message": f"{len(aggps_files)} arquivos AgGPS indexados com sucesso na Jacto Uniport."
                            })
                            imported_any = True

                        # Se contém arquivos JDL
                        if jdl_files:
                            for jf in jdl_files:
                                with open(jf, "rb") as jbf:
                                    j_bytes = jbf.read()
                                parser = JDLParser(j_bytes, os.path.basename(jf))
                                parsed = parser.parse()
                                aid = save_parsed_session(parsed, conn_external=conn)
                                results.append({
                                    "filename": os.path.basename(jf),
                                    "status": "imported",
                                    "type": "John Deere JDL",
                                    "arquivo_id": aid,
                                    "message": "Telemetria importada com sucesso."
                                })
                            imported_any = True

                        if not imported_any:
                            results.append({
                                "filename": fname,
                                "status": "error",
                                "message": "Nenhum arquivo compatível (Shapefiles AgGPS ou JDL) encontrado dentro do pacote."
                            })

                except Exception as e:
                    results.append({
                        "filename": fname,
                        "status": "error",
                        "message": f"Falha ao extrair e indexar pacote: {str(e)}"
                    })
                continue

            # CASO 2: Componentes Shapefiles AgGPS (.shp, .dbf, .shx, .prj, .xml, .kml)
            elif any(lower_name.endswith(ext) for ext in [".shp", ".dbf", ".shx", ".prj", ".xml", ".kml"]):
                try:
                    dest_folder = os.path.join(aggps_target_dir, "Importados_Jacto", "Diretos")
                    os.makedirs(dest_folder, exist_ok=True)
                    target_file = os.path.join(dest_folder, fname)
                    os.makedirs(os.path.dirname(target_file), exist_ok=True)
                    with open(target_file, "wb") as f_out:
                        f_out.write(raw_bytes)
                    results.append({
                        "filename": fname,
                        "status": "imported",
                        "type": "AgGPS Shapefile Component",
                        "destination": "Importados_Jacto/Diretos",
                        "message": "Componente Shapefile salvo com sucesso na Jacto Uniport."
                    })
                except Exception as e:
                    results.append({
                        "filename": fname,
                        "status": "error",
                        "message": str(e)
                    })
                continue

            # CASO 3: Ficheiro Direto .JDL
            elif lower_name.endswith(".jdl"):
                try:
                    parser = JDLParser(raw_bytes, fname)
                    parsed = parser.parse()
                    aid = save_parsed_session(parsed, conn_external=conn)
                    results.append({
                        "filename": fname,
                        "status": "imported",
                        "type": "John Deere JDL",
                        "arquivo_id": aid,
                        "message": "Sessão JDL importada com sucesso."
                    })
                except Exception as e:
                    results.append({
                        "filename": fname,
                        "status": "error",
                        "message": str(e)
                    })
                continue

            else:
                results.append({
                    "filename": fname,
                    "status": "error",
                    "message": "Formato de arquivo não suportado."
                })

    return {
        "total_recebidos": len(files),
        "resultados": results,
        "kpis": get_aggps_kpis()
    }

# ==========================================
# ROTAS DE PÁGINAS (FRONTEND MULTI-MÁQUINAS)
# ==========================================

@app.get("/", response_class=HTMLResponse)
def serve_portal():
    """Portal de Entrada / Hub de Seleção de Máquinas."""
    portal_path = os.path.join(FRONTEND_DIR, "portal.html")
    if os.path.exists(portal_path):
        with open(portal_path, "r", encoding="utf-8") as f:
            return f.read()
    # Fallback se portal.html ainda não existir
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Frontend não encontrado. Verifique a pasta frontend/</h1>"

@app.get("/johndeere", response_class=HTMLResponse)
@app.get("/dashboard", response_class=HTMLResponse)
@app.get("/jdl", response_class=HTMLResponse)
def serve_johndeere():
    """Módulo John Deere G5 (Telemetria CAN/J1939 - .JDL)."""
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        with open(index_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Frontend John Deere não encontrado. Verifique frontend/index.html</h1>"

@app.get("/jacto", response_class=HTMLResponse)
def serve_jacto():
    """Módulo Jacto / Trimble AgGPS (Pulverização - Shapefiles)."""
    jacto_path = os.path.join(FRONTEND_DIR, "jacto.html")
    if os.path.exists(jacto_path):
        with open(jacto_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Frontend Jacto não encontrado. Verifique frontend/jacto.html</h1>"

@app.get("/studio", response_class=HTMLResponse)
@app.get("/isoxml", response_class=HTMLResponse)
def serve_studio():
    """Precision Ag Studio: ISOXML TaskData, Zoneamento Agronômico & JDLink Live Bridge."""
    studio_path = os.path.join(FRONTEND_DIR, "studio.html")
    if os.path.exists(studio_path):
        with open(studio_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Studio não encontrado. Verifique frontend/studio.html</h1>"


# Arquivos estáticos diretos para suporte ao shp.js
from fastapi.responses import FileResponse

@app.get("/shp.js")
def serve_shp_js():
    shp_path = os.path.join(FRONTEND_DIR, "shp.js")
    if os.path.exists(shp_path):
        return FileResponse(shp_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="shp.js not found")

# ==========================================
# ROTAS MASSEY FERGUSON 7318 • TRIMBLE TMX-2050
# ==========================================

@app.get("/massey", response_class=HTMLResponse)
@app.get("/massei", response_class=HTMLResponse)
def serve_massey():
    """Módulo Massey Ferguson 7318 • Trimble TMX-2050 (Precision-IQ)."""
    massey_path = os.path.join(FRONTEND_DIR, "massey.html")
    if os.path.exists(massey_path):
        with open(massey_path, "r", encoding="utf-8") as f:
            return f.read()
    return "<h1>Frontend Massey Ferguson não encontrado. Verifique frontend/massey.html</h1>"

@app.get("/css/style.css")
def serve_massey_css():
    css_path = os.path.join(FRONTEND_DIR, "css", "style.css")
    if os.path.exists(css_path):
        return FileResponse(css_path, media_type="text/css")
    raise HTTPException(status_code=404, detail="style.css not found")

@app.get("/js/app.js")
def serve_massey_js():
    js_path = os.path.join(FRONTEND_DIR, "js", "app.js")
    if os.path.exists(js_path):
        return FileResponse(js_path, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="app.js not found")

@app.get("/api/massey/stats")
@app.get("/api/stats")
def api_massey_stats():
    """Estatísticas operacionais e sumário do Massey Ferguson / Trimble TMX-2050."""
    return get_massey_stats()

@app.get("/api/massey/operations")
@app.get("/api/operations")
def api_massey_operations(
    search: Optional[str] = Query(None),
    farm: Optional[str] = Query(None),
    field: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    serial: Optional[str] = Query(None)
):
    """Lista de operações de aplicação com filtragem dinâmica."""
    return get_massey_operations(search=search, farm=farm, field=field, type=type, serial=serial)

@app.get("/api/massey/operations/{operation_uuid}")
@app.get("/api/operations/{operation_uuid}")
def api_massey_operation_detail(operation_uuid: str):
    """Detalhes de uma operação incluindo XML do manifesto."""
    op = get_massey_operation_by_id(operation_uuid)
    if not op:
        raise HTTPException(status_code=404, detail="Operação não encontrada")
    return op

@app.get("/api/massey/farm-fields")
@app.get("/api/farm-fields")
def api_massey_farm_fields(
    farm: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    variety: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    limit: int = Query(1000, ge=1, le=10000),
    offset: int = Query(0, ge=0)
):
    """Lista de talhões cadastrais do SIG com cruzamento de operações."""
    return get_massey_farm_fields(farm=farm, zone=zone, variety=variety, search=search, limit=limit, offset=offset)

@app.get("/api/massey/farm-fields/geojson")
@app.get("/api/farm-fields/geojson")
def api_massey_farm_fields_geojson(
    farm: Optional[str] = Query(None),
    search: Optional[str] = Query(None)
):
    """GeoJSON FeatureCollection de todos os talhões cadastrais para o Leaflet."""
    return get_massey_farm_fields_geojson(farm=farm, search=search)

@app.post("/api/import-tractor-folder")
@app.post("/api/massey/import-tractor-folder")
@app.post("/api/massey/sync")
@app.get("/api/massey/sync")
@app.get("/api/import-tractor-folder")
def api_import_tractor_folder():
    """Sincroniza e recarrega os dados do trator Massey Ferguson."""
    from .massey_import import import_folder
    return import_folder()

# Monta pasta static apenas se o diretório existir localmente (na Vercel o CDN entrega arquivos estáticos)
if os.path.exists(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get('/api/health')
def health(): return {'status':'ok'}

@app.post('/api/upload-multi')
@app.post('/api/massey/upload')
async def massey_upload(files: List[UploadFile] = File(...)):
    import tempfile
    from pathlib import Path
    from .massey_import import connect, import_file
    results=[]; imported=0
    with tempfile.TemporaryDirectory() as tmp, connect() as conn:
        staged=[]
        for file in files:
            try:
                name=safe_name(file.filename);p=Path(tmp)/name;p.parent.mkdir(parents=True,exist_ok=True)
                raw=await file.read(50*1024*1024+1)
                if len(raw)>50*1024*1024: raise ValueError('Arquivo excede 50 MB')
                p.write_bytes(raw);staged.append((p,name))
            except Exception as e: results.append({'filename':file.filename,'status':'error','message':str(e)})
        for p,name in staged:
            if p.suffix.lower() in ('.dbf','.shx','.prj','.cpg'):continue
            try:
                conn.execute('SAVEPOINT single_file')
                n=import_file(conn,p,name)
                conn.execute('RELEASE single_file');imported+=n
                results.append({'filename':name,'status':'imported' if n else 'duplicate','imported':n})
            except Exception as e:
                conn.execute('ROLLBACK TO single_file');conn.execute('RELEASE single_file')
                results.append({'filename':name,'status':'error','message':str(e)})
    errors=sum(r['status']=='error' for r in results)
    if not results: raise HTTPException(400,'Envie um arquivo SHP com seus componentes, KML, GeoJSON ou ZIP.')
    return JSONResponse(status_code=400 if errors==len(results) else 200,content={'imported':imported,'results':results,'message':f'{imported} registros novos; {errors} arquivos com erro.','detail':next((r['message'] for r in results if r['status']=='error'),None)})

@app.delete('/api/operations/{operation_uuid}')
@app.delete('/api/massey/operations/{operation_uuid}')
def delete_massey_operation(operation_uuid: str):
    from .massey_import import connect
    with connect() as conn:
        count=conn.execute('DELETE FROM agricultural_operations WHERE id=?',(operation_uuid,)).rowcount
    if not count: raise HTTPException(404,'Operação não encontrada')
    return {'success':True,'deleted_count':count}

@app.delete('/api/operations')
@app.delete('/api/massey/operations')
def delete_massey_operations():
    from .massey_import import connect
    with connect() as conn: count=conn.execute('DELETE FROM agricultural_operations').rowcount
    return {'success':True,'deleted_count':count}


# ==========================================
# CENTRAL UNIFICADA DE IMPORTAÇÕES (JDL / AGGPS / TMX)
# ==========================================
from .import_store import (
    MAX_UPLOAD_BYTES, MODULES, lookup_import, register_import, list_imports,
    change_archive, hydrate_jacto_imports
)
import hashlib as _import_hashlib
import json as _import_json


@app.get("/api/importacoes")
def api_import_history(
    module: Optional[str] = Query(None),
    archived: bool = Query(False),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
):
    try:
        return list_imports(module, archived, limit, offset)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/importacoes/upload")
async def api_import_central(module: str = Form(...), files: List[UploadFile] = File(...)):
    """Valida hashes e formatos, reutiliza os parsers nativos e audita no PostgreSQL."""
    if module not in MODULES:
        raise HTTPException(400, "Escolha John Deere, Jacto ou Massey.")
    if not files or len(files) > 50:
        raise HTTPException(400, "Selecione entre 1 e 50 arquivos por lote.")
    allowed = {
        "johndeere": {".jdl", ".zip", ".rar"},
        "jacto": {".zip", ".rar", ".shp", ".dbf", ".shx", ".prj", ".xml", ".kml", ".jdl"},
        "massey": {".zip", ".agf", ".shp", ".dbf", ".shx", ".prj", ".cpg", ".kml", ".geojson", ".json"},
    }
    results = []
    for upload in files:
        name = upload.filename or ""
        try:
            name = safe_name(name)
            from pathlib import Path as _Path
            if _Path(name).suffix.lower() not in allowed[module]:
                raise ValueError("Formato não suportado neste módulo.")
            data = await upload.read(MAX_UPLOAD_BYTES + 1)
            if len(data) > MAX_UPLOAD_BYTES:
                raise ValueError("Arquivo acima de 50 MB.")
            if not data:
                raise ValueError("Arquivo vazio.")
            digest = _import_hashlib.sha256(data).hexdigest()
            existing = lookup_import(module, digest)
            if existing:
                state = "archived" if existing["archived_at"] else "duplicate"
                results.append({"filename": name, "status": state,
                                "records": existing["records_count"],
                                "message": "Arquivo já importado; consulte o histórico."})
                continue
            await upload.seek(0)
            if module == "johndeere":
                response = await api_upload([upload])
                details = response["resultados"]
                count = sum(int(x.get("records_count") or 0) for x in details if x.get("status") == "imported")
                # Arquivo .JDL duplicado dentro do pacote pode não criar sessão nova.
                good = any(x.get("status") == "imported" for x in details)
            elif module == "jacto":
                response = await api_jacto_upload([upload])
                details = response["resultados"]
                count = sum(int(x.get("files_count") or (1 if x.get("status") == "imported" else 0))
                            for x in details)
                good = any(x.get("status") == "imported" for x in details)
            else:
                response = await massey_upload([upload])
                parsed = _import_json.loads(response.body)
                details = parsed["results"]
                count = int(parsed.get("imported") or 0)
                good = any(x.get("status") in ("imported", "duplicate") for x in details)
            if good:
                # Só arquivos AgGPS viram blobs persistentes; JD/MF gravam dados estruturados.
                store_binary = (module == "jacto" and (
                    any("AgGPS" in str(x.get("type", "")) for x in details)
                    or name.lower().endswith((".shp", ".dbf", ".shx", ".prj", ".xml", ".kml"))
                ))
                saved = register_import(module, name, data, count, store_binary=store_binary)
                state = "imported" if saved["new"] else "duplicate"
                results.append({"filename": name, "status": state, "records": count,
                                "id": saved["id"], "message": "Dados e histórico registrados no banco."
                                if saved["new"] else "Arquivo já registrado."})
            else:
                statuses = [x.get("status") for x in details]
                status = "duplicate" if statuses and all(x in ("skipped", "duplicate") for x in statuses) else "error"
                message = next((x.get("message") for x in details if x.get("status") in ("error","rejected")), None)
                if not message and status == "duplicate":
                    message = "Dados anteriormente importados."
                results.append({"filename": name, "status": status, "records": 0,
                                "message": message or "Não foram encontrados registros compatíveis."})
        except Exception as exc:
            # Não classifica como sucesso caso haja falha de parser ou de persistência.
            results.append({"filename": name, "status": "error", "records": 0,
                            "message": str(exc)[:240]})
    counts = {status: sum(x["status"] == status for x in results)
              for status in ("imported", "duplicate", "archived", "error")}
    return {"module": module, "total": len(results), "counts": counts, "results": results}


@app.post("/api/importacoes/{item_id}/archive")
def api_archive_import(item_id: str):
    row = change_archive(item_id, True)
    if row is None:
        raise HTTPException(404, "Importação não encontrada.")
    if row["module"] == "jacto":
        hydrate_jacto_imports(reset=True)
    return row


@app.post("/api/importacoes/{item_id}/restore")
def api_restore_import(item_id: str):
    row = change_archive(item_id, False)
    if row is None:
        raise HTTPException(404, "Importação não encontrada.")
    if row["module"] == "jacto":
        hydrate_jacto_imports(reset=True)
    return row



@app.post("/api/importacoes/chunk/{upload_id}/{index}")
async def api_import_chunk(
    request: Request, upload_id: str, index: int
):
    """Upload de 2 MB/parte para não estourar o limite de requisição da Vercel."""
    import uuid
    from urllib.parse import unquote
    from .import_store import store_chunk
    try:
        if str(uuid.UUID(upload_id)) != upload_id or len(upload_id) != 36:
            raise ValueError("Identificador de upload inválido")
        module = request.headers.get("x-upload-module", "")
        filename = unquote(request.headers.get("x-upload-filename", ""))
        total = int(request.headers.get("x-upload-total", "0"))
        if len(filename) > 240:
            raise ValueError("Nome de arquivo muito longo")
        raw = await request.body()
        store_chunk(upload_id, index, total, module, filename, raw)
        return {"success": True, "part": index, "total": total}
    except (ValueError, OverflowError) as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/importacoes/chunks/finalize")
async def api_finish_chunked_import(payload: dict = Body(...)):
    """Reconstrói o arquivo e o entrega ao mesmo validador da importação direta."""
    import uuid
    import io
    from .import_store import finish_chunks, clear_chunks
    upload_id = str(payload.get("upload_id") or "")
    module = str(payload.get("module") or "")
    filename = str(payload.get("filename") or "")
    try:
        if str(uuid.UUID(upload_id)) != upload_id:
            raise ValueError("Identificador de envio inválido")
        raw = finish_chunks(upload_id, module, filename)
    except (ValueError, OverflowError) as exc:
        raise HTTPException(400, str(exc))
    try:
        buffered = UploadFile(filename=filename, file=io.BytesIO(raw))
        return await api_import_central(module=module, files=[buffered])
    finally:
        clear_chunks(upload_id)
