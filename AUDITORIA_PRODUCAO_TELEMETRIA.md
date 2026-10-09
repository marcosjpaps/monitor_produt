> Auditoria histórica anterior às correções. Para o estado atual, consulte RELATORIO_CORRECOES.md.

# Auditoria Produção - Telemetria Drone

Alterações aplicadas sem alteração visual:

- Validação de coordenadas WGS84 antes da persistência.
- Remoção de pontos GPS duplicados.
- Normalização de latitude/longitude.
- Camada isolada de validação para futuras integrações DJI/MAVLink/PX4.
- Fluxo de importação preparado para validação antes do banco.

Próximas evoluções recomendadas:
- fila assíncrona para arquivos grandes;
- processamento streaming;
- PostGIS para consultas espaciais;
- validação de schema dos formatos de origem.
