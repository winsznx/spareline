# Data licence

The source code in this repository is MIT licensed (see `LICENSE`). The data is not.

`data/processed/bundle.json.gz`, `data/processed/travel_model.json`, `data/processed/curated.json` and everything under `evaluations/` are derived from the **Amazon Last Mile Routing Research Challenge** dataset (2021 release, 2018 routes), published at https://registry.opendata.aws/amazon-last-mile-challenges/ under the **Creative Commons Attribution-NonCommercial 4.0 International** licence (https://creativecommons.org/licenses/by-nc/4.0/).

Those files keep that licence. You may use them for non-commercial purposes with attribution. Changes made: 160 same-station, same-date route groups were selected from the evaluation split; per-route travel matrices were rounded to 0.1 s; package volumes were computed from dimensions; a travel-time estimator and evaluation results were derived.

Citation: Merchán, D., Arora, J., Pachon, J., Konduri, K., Winkenbach, M., Parks, S., Noszek, J. (2022). 2021 Amazon Last Mile Routing Research Challenge: Data Set. *Transportation Science*.

The raw files are not redistributed here. `services/api/app/data/ingest.py` downloads nothing itself; fetch them with an unsigned S3 request as shown in the README.
