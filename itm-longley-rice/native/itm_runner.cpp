#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "itm.h"

struct Options {
  double frequency_mhz = 145.0;
  double tx_height_m = 10.0;
  double rx_height_m = 1.5;
  int climate = 1;
  double surface_refractivity = 301.0;
  int polarization = 1;
  double permittivity = 15.0;
  double conductivity = 0.005;
  double confidence = 50.0;
  double reliability = 50.0;
  std::vector<std::pair<double, double>> profile;
  std::vector<double> distances_km;
};

double to_double(const std::string& value, double fallback = 0.0) {
  char* end = nullptr;
  const double parsed = std::strtod(value.c_str(), &end);
  return end == value.c_str() ? fallback : parsed;
}

std::vector<std::string> split(const std::string& value, char delimiter) {
  std::vector<std::string> parts;
  std::stringstream stream(value);
  std::string part;
  while (std::getline(stream, part, delimiter)) {
    if (!part.empty()) parts.push_back(part);
  }
  return parts;
}

std::vector<double> parse_doubles(const std::string& value) {
  std::vector<double> numbers;
  for (const auto& part : split(value, ',')) {
    const double parsed = to_double(part, NAN);
    if (std::isfinite(parsed) && parsed > 0) numbers.push_back(parsed);
  }
  return numbers;
}

std::vector<std::pair<double, double>> parse_profile(const std::string& value) {
  std::vector<std::pair<double, double>> profile;
  for (const auto& part : split(value, ',')) {
    const auto separator = part.find(':');
    if (separator == std::string::npos) continue;
    const double distance_km = to_double(part.substr(0, separator), NAN);
    const double elevation_m = to_double(part.substr(separator + 1), NAN);
    if (std::isfinite(distance_km) && std::isfinite(elevation_m)) {
      profile.push_back({distance_km, elevation_m});
    }
  }

  std::sort(profile.begin(), profile.end(), [](const auto& left, const auto& right) {
    return left.first < right.first;
  });

  return profile;
}

double interpolate_elevation(const std::vector<std::pair<double, double>>& profile, double distance_km) {
  if (profile.empty()) return 0.0;
  if (distance_km <= profile.front().first) return profile.front().second;

  for (std::size_t index = 1; index < profile.size(); index += 1) {
    const auto& previous = profile[index - 1];
    const auto& next = profile[index];
    if (distance_km > next.first) continue;
    const double span = std::max(1e-9, next.first - previous.first);
    const double ratio = std::clamp((distance_km - previous.first) / span, 0.0, 1.0);
    return previous.second + (next.second - previous.second) * ratio;
  }

  return profile.back().second;
}

Options parse_options(int argc, char** argv) {
  Options options;
  for (int index = 1; index + 1 < argc; index += 2) {
    const std::string key = argv[index];
    const std::string value = argv[index + 1];
    if (key == "--frequency-mhz") options.frequency_mhz = to_double(value, options.frequency_mhz);
    else if (key == "--tx-height-m") options.tx_height_m = to_double(value, options.tx_height_m);
    else if (key == "--rx-height-m") options.rx_height_m = to_double(value, options.rx_height_m);
    else if (key == "--climate") options.climate = static_cast<int>(to_double(value, options.climate));
    else if (key == "--surface-refractivity") options.surface_refractivity = to_double(value, options.surface_refractivity);
    else if (key == "--polarization") options.polarization = static_cast<int>(to_double(value, options.polarization));
    else if (key == "--permittivity") options.permittivity = to_double(value, options.permittivity);
    else if (key == "--conductivity") options.conductivity = to_double(value, options.conductivity);
    else if (key == "--confidence") options.confidence = to_double(value, options.confidence);
    else if (key == "--reliability") options.reliability = to_double(value, options.reliability);
    else if (key == "--profile") options.profile = parse_profile(value);
    else if (key == "--distances-km") options.distances_km = parse_doubles(value);
  }
  return options;
}

std::vector<double> make_pfl(const Options& options, double distance_km) {
  const double total_m = std::max(1000.0, distance_km * 1000.0);
  const int segments = std::max(2, static_cast<int>(std::ceil(total_m / 500.0)));
  const double step_m = total_m / segments;
  std::vector<double> pfl(static_cast<std::size_t>(segments) + 3);
  pfl[0] = segments;
  pfl[1] = step_m;

  for (int index = 0; index <= segments; index += 1) {
    const double sample_distance_km = (step_m * index) / 1000.0;
    pfl[static_cast<std::size_t>(index) + 2] = interpolate_elevation(options.profile, sample_distance_km);
  }

  return pfl;
}

int main(int argc, char** argv) {
  const Options options = parse_options(argc, argv);
  if (options.profile.empty() || options.distances_km.empty()) {
    std::cerr << "Missing profile or distances" << std::endl;
    return 2;
  }

  std::cout << "{\"losses\":[";
  bool first = true;

  for (const double distance_km : options.distances_km) {
    const auto pfl = make_pfl(options, distance_km);
    double loss_db = 0.0;
    long warnings = 0;
    const int error_code = ITM_P2P_CR(
      options.tx_height_m,
      options.rx_height_m,
      pfl.data(),
      options.climate,
      options.surface_refractivity,
      options.frequency_mhz,
      options.polarization,
      options.permittivity,
      options.conductivity,
      0,
      options.confidence,
      options.reliability,
      &loss_db,
      &warnings
    );

    if (!first) std::cout << ",";
    first = false;
    std::cout << "{\"distanceKm\":" << distance_km
              << ",\"lossDb\":" << loss_db
              << ",\"warnings\":" << warnings
              << ",\"errorCode\":" << error_code
              << "}";
  }

  std::cout << "]}" << std::endl;
  return 0;
}
