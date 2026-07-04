import time
from supabase import create_client

SUPABASE_URL = "https://cyqqohycenkoludiefgq.supabase.co"
SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cXFvaHljZW5rb2x1ZGllZmdxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTc1MTY2NiwiZXhwIjoyMDk1MzI3NjY2fQ.quRpGCpwwDBZrhMGaIjNzROSRiArnMV1RVFT7nV1lew"  # NOT the anon key

client = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

response = client.auth.admin.create_user({
    "email": "333333333@babelens.internal",
    "password": "babelens123",
    "email_confirm": True
})
user_id = response.user.id
client.table("profiles").insert({
    "id": user_id,
    "nip_lama": "333333333",
    "nama": "Test User 2 Google",
    "must_change_password": True
}).execute()
print("done", user_id)