DELETE FROM students WHERE student_number IN ('2023-00123-MN', '2022-00456-MN');

INSERT INTO students (student_number, first_name, last_name, email, program, year_level, is_irregular, is_shifter, password_hash, password_salt, qr_token) VALUES
('22-23-065', 'Roi', 'Perez', 'roi.perez@udm.edu.ph', 'BSIT', 3, 1, 0, 'fb7669a2f40626ed761ec611d3ccabdc243c60bc5afeb098180b47ed0492183d', '57aa199a103e8b84aa5b300dc51c0caf', 'UDM-F27EA99DE2202F4CAAADA9C1'),
('23-24-142', 'Justine', 'Alonzo', 'justine.alonzo@udm.edu.ph', 'BSIT', 2, 0, 1, '923c6c2c0092e11b20dfc77168435568a66de61419ea265aa871ab0f4b496d1c', 'f7568a9a60427c250a2a4e1779e4542e', 'UDM-4CFABACD2EDF560D52947F82');
