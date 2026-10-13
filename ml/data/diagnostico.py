import pandas as pd

df = pd.read_parquet("ml/data/output/dataset_2026-10-05.parquet")

print("--- siniestros_semana_siguiente ---")
print(df["siniestros_semana_siguiente"].value_counts())
print()
print("--- siniestros_12m ---")
print(df["siniestros_12m"].value_counts().head(10))
print()
print("max siniestros_semana_siguiente:", df["siniestros_semana_siguiente"].max())
print("max siniestros_12m:", df["siniestros_12m"].max())