"""Status honesto: nenhuma integração JDLink autenticada foi configurada."""
def get_jdlink_status():
    return {"connected":False,"environment":"Não configurado","demo":False,"message":"Integração JDLink requer credenciais e autorização da John Deere.","organization":None,"telematics":{"total_machines":0,"working_machines":0,"idle_machines":0,"total_fuel_burn_lh":0,"fleet":[]}}
