#pragma once

#include <Arduino.h>

// #ifndef GEOZONE
// #define GEOZONE utah
// #endif

#define MOA_ON
#define CALIFORNIA

struct GeoFenceStruct
{
    const float (*edges)[4]; // never modified, const stores on flash instead of RAM since these are large
    const size_t num_edges;
    const float geo_alt;
    int checksLeft; 

};


// for developer readability
namespace GeoData
{
    extern GeoFenceStruct* allGeos[];
    extern const size_t num_geoZones;
}
