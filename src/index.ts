import axios, { AxiosResponse } from 'axios';
import * as json2csv from 'json2csv';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
const HttpsProxyAgent = require("https-proxy-agent");

dotenv.config();

// Term id found from this request
// https://svc.bkstr.com/courseMaterial/info?storeId=11003

interface ISection {
    courseId: string;
    courseRefId: string;
    sectionName: string;
};


interface ICourse {
    courseName: string;
    section: ISection[];
};

interface IDepartment {
    depName: string;
    course: ICourse[];
};

(async () => {
    const termId = "100063052";

    const departments = await getCourses(termId);

    console.log('Departments', departments.length);

    const courseMaterials: any[] = [];

    // Loop through everything
    for (let depIndex = 0; depIndex < departments.length; depIndex++) {
        const department = departments[depIndex];
        const sectionsToRequest: any[] = [];

        for (let courseIndex = 0; courseIndex < department.course.length; courseIndex++) {
            const course = department.course[courseIndex];

            for (let sectionIndex = 0; sectionIndex < course.section.length; sectionIndex++) {
                const section = course.section[sectionIndex];

                // Create array of sections from course to request all at once
                sectionsToRequest.push({
                    courseDisplayName: course.courseName,
                    departmentDisplayName: department.depName,
                    divisionDisplayName: "",
                    sectionDisplayName: section.sectionName
                });
            }
        }

        console.log('Department', department.depName);

        let courseSectionResults: any;

        console.log('Total coursesToRequest', sectionsToRequest.length);
        // Can only includes 30 sections per request
        const totalRequests = Math.ceil(sectionsToRequest.length / 30);

        for (let i = 0; i < totalRequests; i++) {

            try {
                courseSectionResults = await getCourseMaterials(termId, sectionsToRequest.slice(i * 30, 30));
            }
            catch (e) {
                console.log('Error requesting', e?.response?.status ? e.response.status : e);
                throw 'Error here';
            }

            for (let courseSectionResult of courseSectionResults) {
                // Sections that aren't successes don't have materials
                if (courseSectionResult.courseSectionStatus?.status === 'SUCCESS') {
                    const courseMaterial = courseSectionResult.courseMaterialResultsList;

                    if (courseMaterial) {
                        for (let i = 0; i < courseMaterial.length; i++) {
                            const flattenedMaterials = flattenData(courseMaterial[i], department.depName, courseSectionResult.courseName, courseSectionResult.sectionName);
                            courseMaterials.push(...flattenedMaterials);
                        }
                    }
                    else {
                        console.log('Could not find Department', department.depName, 'Course', courseSectionResult.courseName,
                            'Section', courseSectionResult.sectionName);
                    }

                }

            }
            // We are hitting fairly hard. Going to wait 5 seconds between requests
            await timeout(5000);
        }
    }


    const csv = json2csv.parse(courseMaterials);
    fs.writeFile('Books.csv', csv, (err) => {
        if (err) {
            console.log('Some error', err);
        }
    });


})();

// Get term 
async function getCourses(termId: string): Promise<IDepartment[]> {
    const url = `https://svc.bkstr.com/courseMaterial/courses?storeId=11003&termId=${termId}`;

    const axiosResponse = await axios.get(url, {
        headers: {
            // Don't add a cookie
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36'
        },
        proxy: false,
        httpsAgent: new HttpsProxyAgent(`https://${process.env.luminatiUsername}:${process.env.luminatiPassword}@zproxy.lum-superproxy.io:22225`)
    });

    return axiosResponse?.data?.finalDDCSData?.division[0]?.department;
}

async function getCourseMaterials(termId: string, sectionsToRequest: any[]) {
    // POST
    const url = `https://svc.bkstr.com/courseMaterial/results?storeId=11003&langId=-1&catalogId=11077&requestType=DDCSBrowse`;

    const body = {
        storeId: "11003",
        termId: termId,
        // Can send an array of up to 30 sections
        courses: sectionsToRequest,
        programId: null
    };

    let axiosResponse: AxiosResponse;
    // Looking for courseSectionDTO
    axiosResponse = await axios.post(url, body, {
        headers: {
            // Don't add a cookie
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.121 Safari/537.36'
        },
        proxy: false,
        httpsAgent: new HttpsProxyAgent(`https://${process.env.luminatiUsername}:${process.env.luminatiPassword}@zproxy.lum-superproxy.io:22225`)
    });

    return axiosResponse?.data[0]?.courseSectionDTO;

}

function flattenData(courseMaterial: any, departmentName: string, courseName: string, sectionName: string) {
    const materials: any[] = [];

    const courseData: any = {
        department: departmentName,
        course: courseName,
        section: sectionName,
        author: courseMaterial.author,
        bookImage: courseMaterial.bookImage,
        edition: courseMaterial.edition,
        isbn: courseMaterial.isbn,
        title: courseMaterial.title,
        publisher: courseMaterial.publisher
    };

    // for non digital items
    if (courseMaterial.printItemDTOs) {

        for (let key in courseMaterial.printItemDTOs) {
            if (courseMaterial.printItemDTOs.hasOwnProperty(key)) {
                const printItem: any = {
                    ...courseData
                };
                printItem.price = courseMaterial.printItemDTOs[key].priceNumeric;
                printItem.forRent = key.toLocaleLowerCase().includes('rent');
                printItem.print = true;

                materials.push(printItem);
            }
        }
    }
    if (courseMaterial.digitalItemDTOs) {

        for (let i = 0; i < courseMaterial.digitalItemDTOs.length; i++) {
            const digitalItem = {
                subscriptionTime: courseMaterial.digitalItemDTOs[0].subscription,
                price: courseMaterial.digitalItemDTOs[0].priceNumeric,
                print: false,
                forRent: true,
                ...courseData
            };

            materials.push(digitalItem);
        }
    }

    return materials;
}


function timeout(ms: number) {
    return new Promise(res => setTimeout(res, ms));
}
